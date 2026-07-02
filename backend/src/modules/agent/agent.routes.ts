import { Router } from "express";
import { testAgentReply } from "./agent.controller";

const router = Router();

router.post("/test", testAgentReply);

export default router;
