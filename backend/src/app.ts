import express from "express";
import cors from "cors";
import helmet from "helmet";
import healthRoutes from "./routes/health.routes";
import aiRoutes from "./modules/ai/ai.routes";
import agentRoutes from "./modules/agent/agent.routes";
import intentRouterRoutes from "./modules/agent/intent-router.routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/", healthRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/agent", intentRouterRoutes);

app.use((_req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

export default app;
