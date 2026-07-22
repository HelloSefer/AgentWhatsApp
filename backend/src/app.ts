import express from "express";
import cors from "cors";
import helmet from "helmet";
import healthRoutes from "./routes/health.routes";
import legalRoutes from "./routes/legal.routes";
import aiRoutes from "./modules/ai/ai.routes";
import agentRoutes from "./modules/agent/agent.routes";
import intentRouterRoutes from "./modules/agent/intent-router.routes";
import conversationSessionRoutes from "./modules/agent/session/conversation-session.routes";
import whatsappCloudRoutes from "./modules/whatsapp/cloud/whatsapp-cloud.routes";
import orderFormRoutes from "./modules/order-form/order-form.routes";
import orderReceiptRoutes from "./modules/order-receipt/order-receipt.routes";
import conversationConfigRoutes from "./modules/conversation-engine/conversation-config.routes";
import databaseHealthRoutes from "./infrastructure/database/health/database-health.routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

app.use("/", healthRoutes);
app.use("/", legalRoutes);
app.use("/", orderFormRoutes);
app.use("/", orderReceiptRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/agent/conversation-config", conversationConfigRoutes);
app.use("/api/agent", intentRouterRoutes);
app.use("/api/agent/session", conversationSessionRoutes);
app.use("/api/whatsapp/cloud", whatsappCloudRoutes);
app.use("/api/database", databaseHealthRoutes);

app.use((_req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

export default app;
