import mongoose, { Schema, Document, Types } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  avatar?: string;
  accessToken: string;
  refreshToken: string;
  authProvider: "google" | "spotify";
  plan: "free" | "pro";
  freeGenerationsUsed: number;
  freeGenerationLimit: number;
  aiGenerationsUsed: number;
  preferences: {
    genres: string[];
    moods: string[];
  };
  spotify: {
    accessToken: string;
    refreshToken: string;
    playlists?: [];
  };
  history: Types.ObjectId[]; // references Playlist IDs
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatar: String,
    accessToken: { type: String, },
    refreshToken: { type: String, },
    authProvider: { type: String, enum: ["google", "spotify"], required: true },
    plan: { type: String, enum: ["free", "pro"], default: "free" },
    freeGenerationsUsed: { type: Number, default: 0 },
    freeGenerationLimit: { type: Number, default: 6 },
    aiGenerationsUsed: { type: Number, default: 0 },
    preferences: {
      genres: [{ type: String }],
      moods: [{ type: String }],
    },
    spotify: {
      accessToken: { type: String },
      refreshToken: { type: String },
      playlists: [
  {
    id: { type: String },
    mood: { type: String },
    genres: [{ type: String }],
    count: { type: Number },
    tracks: [
      {
        id: String,
        name: String,
        artist: String,
        uri: String,
        image: String,
        preview: String,
      },
    ],
    status: { type: String, enum: ["draft", "confirmed"], default: "draft" },
    createdAt: { type: Date, default: Date.now },
  },
],
    },
    history: [{ type: Schema.Types.ObjectId, ref: "Playlist" }],
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
