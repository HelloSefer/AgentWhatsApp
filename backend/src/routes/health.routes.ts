import { Router } from "express";
import { env } from "../config/env";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    app: env.appName,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

export default router;