import pino from "pino";
import app from "./app";
import { env } from "./config/env";

const logger = pino({
  transport:
    env.nodeEnv === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        }
      : undefined,
});

app.listen(env.port, () => {
  logger.info(`${env.appName} is running on port ${env.port}`);
});