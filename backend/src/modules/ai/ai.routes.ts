import { Router } from "express";
import { testAIReply } from "./ai.controller";

const router = Router();

router.post("/test", testAIReply);

export default router;
