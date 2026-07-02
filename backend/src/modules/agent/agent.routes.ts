import { Router } from "express";
import { listAgentOrders, testAgentReply } from "./agent.controller";

const router = Router();

router.post("/test", testAgentReply);
router.get("/orders", listAgentOrders);

export default router;
