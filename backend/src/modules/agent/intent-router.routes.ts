import { Router } from "express";
import { analyzeAgentMessage } from "./intent-router.controller";

const router = Router();

router.post("/analyze", analyzeAgentMessage);

export default router;
