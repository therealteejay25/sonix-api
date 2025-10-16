import mongoose, { Schema } from "mongoose";

const PlaylistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  spotifyPlaylistId: { type: String, required: true },
  name: { type: String, required: true },
  mood: { type: String },
  genres: [{ type: String }],
  tracks: [
    {
      id: String,
      name: String,
      artist: String,
      uri: String,
      image: String,
      preview: String
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Playlist", PlaylistSchema);
