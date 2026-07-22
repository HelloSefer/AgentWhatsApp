import { Router } from "express";
import {
  getEffectiveConversationConfigController,
  previewConversationConfigController,
  validateConversationConfigController,
} from "./conversation-config.controller";

const router = Router();

router.post("/validate", validateConversationConfigController);
router.post("/preview", previewConversationConfigController);
router.get("/effective/:sellerId", getEffectiveConversationConfigController);

export default router;
