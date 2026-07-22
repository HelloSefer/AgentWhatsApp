import { Router } from "express";
import { getDatabaseHealth } from "./database-health.service";

const router = Router();

router.get("/health", async (_req, res) => {
  const health = await getDatabaseHealth();
  res.status(health.reachable ? 200 : 503).json(health);
});

export default router;
