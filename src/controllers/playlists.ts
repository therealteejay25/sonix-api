import { Request, Response } from "express";
import axios from "axios";
import User from "../models/User";
import Playlist from "../models/Playlist";

/**
 * Helper: get app access token via Client Credentials (for unauthenticated/new users)
 */
async function getAppAccessToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in env");

  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  return resp.data.access_token as string;
}

/**
 * Helper: Spotify request wrapper with auto-refresh
 */
async function spotifyRequest(
  method: "get" | "post",
  url: string,
  opts: { accessToken?: string; appToken?: string; data?: any; params?: any; refreshToken?: string; userId?: string }
) {
  const token = opts.accessToken || opts.appToken;
  const headers: any = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    if (method === "get") return await axios.get(url, { headers, params: opts.params });
    return await axios.post(url, opts.data, { headers, params: opts.params });
  } catch (err: any) {
    if (err.response?.status === 401 && opts.refreshToken && opts.userId) {
      console.log("🔄 Access token expired — refreshing Spotify token...");
      try {
        const refreshResp = await axios.post(
          "https://accounts.spotify.com/api/token",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: opts.refreshToken,
            client_id: process.env.SPOTIFY_CLIENT_ID!,
            client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
          }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const newAccessToken = refreshResp.data.access_token;
        if (!newAccessToken) throw new Error("No new access token returned.");

        // Update user's access token in DB
        await User.findByIdAndUpdate(opts.userId, { "spotify.accessToken": newAccessToken });
        console.log("✅ Spotify token refreshed successfully, retrying request...");

        const retryHeaders = { Authorization: `Bearer ${newAccessToken}` };
        if (method === "get") return await axios.get(url, { headers: retryHeaders, params: opts.params });
        return await axios.post(url, opts.data, { headers: retryHeaders, params: opts.params });
      } catch (refreshErr: any) {
        console.error("❌ Failed to refresh token:", refreshErr.message);
        throw refreshErr;
      }
    }

    throw err;
  }
}

/**
 * Helper: fetch top tracks for an artist (works even for app-only users)
 */
async function fetchArtistTopTracks(artistId: string, token: string) {
  const url = `https://api.spotify.com/v1/artists/${artistId}/top-tracks`;
  const res = await spotifyRequest("get", url, { accessToken: token, appToken: token, params: { market: "US" } });
  return res.data.tracks || [];
}

/**
 * Generate intelligent playlist (handles both logged-in users and new ones)
 */
export const generatePlaylist = async (req: Request, res: Response) => {
  const { mood, genres = [], count = 20 } = req.body;
  const userId = (req as any).userId;

  console.log("🟢 Starting intelligent playlist generation...");
  console.log("Request body:", JSON.stringify(req.body));

  if (!mood || !Array.isArray(genres) || !genres.length) {
    return res.status(400).json({ error: "Mood + at least one genre required." });
  }

  try {
    const user = userId ? await User.findById(userId) : null;
    const userToken = user?.spotify?.accessToken;
    const refreshToken = user?.spotify?.refreshToken;
    let appToken: string | undefined = undefined;

    if (!userToken) {
      console.log("⚠️ No user token — using app client credentials for Spotify requests.");
      appToken = await getAppAccessToken();
    } else {
      console.log("✅ User connected to Spotify (token present)");
    }

    // Map genres
    const genreMap: Record<string, string> = {
      rnb: "r-n-b",
      hiphop: "hip-hop",
      edm: "edm",
      pop: "pop",
      soul: "soul",
      rock: "rock",
      jazz: "jazz",
      classical: "classical",
      afrobeat: "afrobeat",
    };
    const seedGenres = genres.map(g => genreMap[g.toLowerCase()] || g.toLowerCase()).slice(0, 2);

    // Mood attributes
    const moodMap: Record<string, any> = {
      chill: { energy: [0, 0.5], danceability: [0.4, 0.6], valence: [0.4, 0.6] },
      sad: { energy: [0, 0.3], valence: [0, 0.4] },
      party: { energy: [0.7, 1], danceability: [0.7, 1], valence: [0.6, 1] },
      focus: { energy: [0.3, 0.6], instrumentalness: [0.5, 1] },
      hype: { energy: [0.8, 1], valence: [0.7, 1] },
    };
    const target = moodMap[mood.toLowerCase()] || {};

    let candidateTracks: any[] = [];

    // If user token → personalize
    if (userToken) {
      try {
        console.log("Fetching user's top tracks & artists...");
        const [tracksRes, artistsRes] = await Promise.all([
          spotifyRequest("get", "https://api.spotify.com/v1/me/top/tracks?limit=5", {
            accessToken: userToken,
            refreshToken,
            userId,
          }),
          spotifyRequest("get", "https://api.spotify.com/v1/me/top/artists?limit=5", {
            accessToken: userToken,
            refreshToken,
            userId,
          }),
        ]);

        const topTracks = tracksRes.data.items || [];
        const topArtists = artistsRes.data.items || [];
        candidateTracks.push(...topTracks);

        for (const a of topArtists) {
          try {
            const artistTop = await fetchArtistTopTracks(a.id, userToken);
            if (artistTop.length) candidateTracks.push(...artistTop.slice(0, 5));
          } catch (err: any) {
            console.log(`⚠️ Couldn't fetch top tracks for ${a.name}:`, err.message);
          }
        }
      } catch (err: any) {
        console.log("⚠️ Failed to fetch user's top tracks/artists:", err.message);
      }
    }

    // Always search Spotify by genre + mood
    for (const genre of seedGenres) {
      try {
        const res = await spotifyRequest("get", "https://api.spotify.com/v1/search", {
          accessToken: userToken,
          appToken,
          refreshToken,
          userId,
          params: { q: `${genre} ${mood}`, type: "track", limit: 50, market: "US" },
        });
        candidateTracks.push(...(res.data.tracks?.items || []));
      } catch (err: any) {
        console.log(`⚠️ Search failed for ${genre}:`, err.message);
      }
    }

    // Dedupe
    const byId = new Map<string, any>();
    for (const t of candidateTracks) if (t?.id && !byId.has(t.id)) byId.set(t.id, t);
    candidateTracks = Array.from(byId.values());
    console.log("Candidate pool size:", candidateTracks.length);

    if (!candidateTracks.length) return res.status(404).json({ error: "No tracks found." });

    // Fetch audio features
    const poolIds = candidateTracks.map(t => t.id).slice(0, 100);
    let featuresMap: Record<string, any> = {};
    try {
      const featuresResp = await spotifyRequest("get", "https://api.spotify.com/v1/audio-features", {
        accessToken: userToken,
        appToken,
        refreshToken,
        userId,
        params: { ids: poolIds.join(",") },
      });
      for (const f of featuresResp.data.audio_features || []) if (f && f.id) featuresMap[f.id] = f;
    } catch (err: any) {
      console.log("⚠️ Audio-features fetch failed:", err.message);
    }

    // Filter
    const filtered = candidateTracks.filter(t => {
      const f = featuresMap[t.id];
      if (!f || Object.keys(target).length === 0) return true;
      return Object.keys(target).every(attr => {
        const [min, max] = target[attr];
        return typeof f[attr] === "number" && f[attr] >= min && f[attr] <= max;
      });
    });

    const pool = filtered.length ? filtered : candidateTracks;
    const selected = pool.sort(() => Math.random() - 0.5).slice(0, count);

    const finalTracks = selected.map(t => ({
      id: t.id,
      name: t.name,
      artist: (t.artists || []).map((a: any) => a.name).join(", "),
      uri: t.uri,
      image: t.album?.images?.[0]?.url || null,
      preview: t.preview_url || null,
    }));

    const draft = {
      id: `draft_${Date.now()}`,
      mood,
      genres: seedGenres,
      count,
      tracks: finalTracks,
      status: "draft",
      createdAt: new Date(),
    };

    if (user) {
      user.spotify.playlists = user.spotify.playlists || [];
      user.spotify.playlists.push(draft as never);
      await user.save();
      console.log("✅ Draft saved to user.spotify.playlists");
    }

    return res.json({ message: "Playlist generated successfully.", draft });
  } catch (err: any) {
    console.error("❌ Playlist generation error:", err.message);
    return res.status(500).json({ error: "Failed to generate playlist." });
  }
};

/**
 * Delete a track from draft
 */
export const deleteTrackFromDraft = async (req: Request, res: Response) => {
  const { draftId, trackId } = req.body;
  const userId = (req as any).userId;
  console.log("🗑 Deleting track:", { userId, draftId, trackId });

  try {
    if (!userId) return res.status(401).json({ error: "Not authenticated." });
    const user = await User.findById(userId);
    const draft = user?.spotify?.playlists?.find((p: any) => p.id === draftId) as any;
    if (!draft) return res.status(404).json({ error: "Draft not found." });

    draft.tracks = draft.tracks.filter((t: any) => t.id !== trackId);
    await user!.save();
    return res.json({ message: "Track deleted.", draft });
  } catch (err: any) {
    console.error("❌ Delete track error:", err.message);
    return res.status(500).json({ error: "Failed to delete track." });
  }
};

/**
 * Push draft to Spotify and save as Playlist
 */
export const pushDraftToSpotify = async (req: Request, res: Response) => {
  const { draftId } = req.body;
  const userId = (req as any).userId;
  console.log("🚀 Pushing draft:", { userId, draftId });

  try {
    const user = await User.findById(userId);
    const accessToken = user?.spotify?.accessToken;
    const refreshToken = user?.spotify?.refreshToken;
    if (!accessToken) return res.status(401).json({ error: "User not connected to Spotify." });

    const draftIndex = user.spotify.playlists!.findIndex((p: any) => p.id === draftId);
    if (draftIndex === -1) return res.status(404).json({ error: "Draft not found." });
    const draft = user.spotify.playlists![draftIndex] as any;

    const createRes = await spotifyRequest("post", "https://api.spotify.com/v1/me/playlists", {
      accessToken,
      refreshToken,
      userId,
      data: {
        name: `${draft.mood} playlist`,
        description: `Generated by app — mood: ${draft.mood}`,
        public: false,
      },
    });

    const spotifyPlaylistId = createRes.data.id;
    const uris = draft.tracks.map((t: any) => t.uri);
    for (let i = 0; i < uris.length; i += 100) {
      await spotifyRequest("post", `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`, {
        accessToken,
        refreshToken,
        userId,
        data: { uris: uris.slice(i, i + 100) },
      });
    }

    const playlistDoc = new Playlist({
      user: userId,
      spotifyPlaylistId,
      name: createRes.data.name,
      mood: draft.mood,
      genres: draft.genres,
      tracks: draft.tracks,
      createdAt: new Date(),
    });
    await playlistDoc.save();

    user.spotify.playlists!.splice(draftIndex, 1);
    await user.save();

    return res.json({ message: "Playlist pushed to Spotify.", playlist: playlistDoc });
  } catch (err: any) {
    console.error("❌ Push draft error:", err.message);
    return res.status(500).json({ error: "Failed to push draft." });
  }
};

/**
 * 🗂 Fetch all playlists that were pushed to Spotify (history)
 */
export const getPlaylistHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    console.log("📜 Fetching playlist history for user:", userId);

    const playlists = await Playlist.find({ user: userId }).sort({
      createdAt: -1,
    });

    if (!playlists.length)
      return res.status(200).json({ message: "No playlist history found", playlists: [] });

    console.log(`✅ Found ${playlists.length} playlists`);
    res.status(200).json({ playlists });
  } catch (err) {
    console.error("❌ Error fetching playlist history:", err);
    res.status(500).json({ error: "Failed to fetch playlist history" });
  }
};

/**
 * 📝 Fetch draft playlist stored in user.spotify.playlists (if any)
 */
export const getDraftHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    console.log("📄 Fetching draft playlists for user:", userId);

    const user = await User.findById(userId);

    if (!user)
      return res.status(404).json({ error: "User not found" });

    const drafts = user.spotify?.playlists?.filter(
      (p: any) => p.status === "draft"
    );

    if (!drafts || drafts.length === 0)
      return res.status(200).json({ message: "No draft playlists found", drafts: [] });

    console.log(`✅ Found ${drafts.length} draft playlists`);
    res.status(200).json({ drafts });
  } catch (err) {
    console.error("❌ Error fetching draft playlists:", err);
    res.status(500).json({ error: "Failed to fetch draft playlists" });
  }
};
