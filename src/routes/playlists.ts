import express from "express";
import { authMiddleware } from "../middleware/auth";
import {
  generatePlaylist,
  deleteTrackFromDraft,
  pushDraftToSpotify,
  getPlaylistHistory,
  getDraftHistory,
} from "../controllers/playlists";

const router = express.Router();

router.post("/generate", authMiddleware, generatePlaylist);
router.delete("/draft/track", authMiddleware, deleteTrackFromDraft);
router.post("/draft/push", authMiddleware, pushDraftToSpotify);
// ✅ Fetch playlist and draft history
router.get("/history", authMiddleware, getPlaylistHistory);
router.get("/drafts", authMiddleware, getDraftHistory);
export default router;
