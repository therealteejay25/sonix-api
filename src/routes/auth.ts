import { Router } from "express";
import { spotifyLogin, spotifyCallback, getMe, logout } from "../controllers/auth";
import { authMiddleware } from "../middleware/auth";

const router = Router();

router.get("/login", spotifyLogin);

router.get("/callback", spotifyCallback);

router.get("/api/me", authMiddleware, getMe);

router.post("/logout", authMiddleware, logout);

export default router;
