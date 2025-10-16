import { Request, Response } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import User from "../models/User";
import dotenv from "dotenv";

dotenv.config();

const generateJWT = (userId: string) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET!, { expiresIn: "7d" });

// Spotify login redirect
export const spotifyLogin = (req: Request, res: Response) => {
  const scope = [
  "user-read-email",
  "user-read-private",
  "user-top-read",           // 🔹 needed for personalized recommendations
  "playlist-read-private",   // 🔹 optional if you read playlists
  "playlist-modify-private", // 🔹 if you want private playlists
  "playlist-modify-public"   // 🔹 to push public playlists
].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
};

// Callback from Spotify
export const spotifyCallback = async (req: Request, res: Response) => {
  const code = req.query.code as string;
  try {
    // 1️⃣ Get Spotify tokens
    const tokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const {
      access_token: spotifyAccess,
      refresh_token: spotifyRefresh,
    } = tokenRes.data;

    // 2️⃣ Get Spotify profile
    const profileRes = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${spotifyAccess}` },
    });

    const spotifyProfile = profileRes.data;

    // 3️⃣ Find or create user
    let user = await User.findOne({ email: spotifyProfile.email });

    if (!user) {
      user = await User.create({
        name: spotifyProfile.display_name,
        email: spotifyProfile.email,
        avatar: spotifyProfile.images?.[0]?.url,
        authProvider: "spotify",
        plan: "free",
        freeGenerationsUsed: 0,
        freeGenerationLimit: 6,
        aiGenerationsUsed: 0,
        preferences: { genres: [], moods: [] },
        history: [],
        spotify: { accessToken: spotifyAccess, refreshToken: spotifyRefresh },
      });
    } else {
      // Update Spotify tokens if user already exists
      user.spotify = {
        accessToken: spotifyAccess,
        refreshToken: spotifyRefresh,
      };
      await user.save();
    }

    // 4️⃣ Now generate app tokens (after user exists)
    const appAccessToken = jwt.sign({ id: user._id!.toString() }, process.env.JWT_SECRET!, {
      expiresIn: "7d",
    });
    const appRefreshToken = jwt.sign(
      { id: user._id!.toString() },
      process.env.REFRESH_SECRET!,
      { expiresIn: "30d" }
    );

    // 5️⃣ Save app tokens in DB
    user.accessToken = appAccessToken;
    user.refreshToken = appRefreshToken;
    await user.save();

    // 6️⃣ Set access token cookie
    res.cookie("token", appAccessToken, {
      httpOnly: true,
      secure: false, // set to true in production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    });

     console.log("✅ Cookies set successfully");

    // 7️⃣ Redirect to frontend
    res.json({ message: "Successfull", data: user });
  } catch (err) {
    console.error("Spotify auth error:", err);
    res.status(400).json({ error: "Spotify login failed" });
  }
};

// Get current user from Spotify
export const getMe = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.token
    const userId = (req as any).userId;
    console.log(token)
    console.log(userId)

    // 1️⃣ Find user in DB
    const user = await User.findById(userId);
    if (!user || !user.spotify) {
      return res
        .status(404)
        .json({ error: "User not found or not connected to Spotify" });
    }

    const { accessToken, refreshToken } = user.spotify;

    // 2️⃣ Fetch profile from Spotify
    let profile;
    try {
      const profileRes = await axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      profile = profileRes.data;
    } catch (err: any) {
      // If access token expired, refresh it
      if (err.response?.status === 401) {
        const tokenRes = await axios.post(
          "https://accounts.spotify.com/api/token",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: process.env.SPOTIFY_CLIENT_ID!,
            client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
          }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const newAccessToken = tokenRes.data.access_token;

        // Save new access token in DB
        user.spotify.accessToken = newAccessToken;
        await user.save();

        // Retry profile fetch
        const profileRes = await axios.get("https://api.spotify.com/v1/me", {
          headers: { Authorization: `Bearer ${newAccessToken}` },
        });
        profile = profileRes.data;
      } else {
        throw err;
      }
    }

    res.json({
      profile,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
};


export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    if (!userId)
      return res.status(400).json({ error: "No active session found" });

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ error: "User not found" });

    // 🧹 Clear tokens in DB
    user.accessToken = "";
    user.refreshToken = "";


    await user.save();

    // 🍪 Clear cookie
    res.clearCookie("token", {
      httpOnly: true,
      secure: false, // true in production
      sameSite: "lax",
    });

    console.log(`🚪 User ${user.email} logged out successfully`);

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (err: any) {
    console.error("❌ Logout error:", err.message);
    res.status(500).json({ error: "Failed to logout user" });
  }
};