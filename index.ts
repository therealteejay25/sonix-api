import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./src/config/db";
import authRoutes from "./src/routes/auth";
import cookieParser from "cookie-parser";
import playlistRoutes from "./src/routes/playlists";

dotenv.config();

const app = express();
const port = process.env.PORT!;

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000", // fixed typo from 300
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(cookieParser());

// Add cookie test route
app.get("/test-cookie", (req, res) => {
  res.cookie("test", "cookie-value", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.json({ message: "Test cookie set" });
});

// Basic route
app.get("/ping", (req, res) => {
  res.json({ message: "Pong!" });
});

connectDB();

app.use("/auth", authRoutes);
app.use("/api/playlists", playlistRoutes);


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
