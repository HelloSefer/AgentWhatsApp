import { Router } from "express";
import { env } from "../config/env";
import { buildWhatsAppPhase8RuntimeReadiness } from "../composition/queue/whatsapp-phase8-runtime-readiness";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    app: env.appName,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

router.get("/health/whatsapp-phase-8-runtime", async (_req, res) => {
  const readiness = await buildWhatsAppPhase8RuntimeReadiness();
  res.status(readiness.status === "ready" || readiness.status === "disabled" ? 200 : 503).json(readiness);
});

export default router;
