import pino from "pino";
import app from "./app";
import { env } from "./config/env";
import { warmNaturalReplyModel } from "./modules/agent/natural-reply/natural-reply-generator.service";
import { cleanupOldOrderReceiptPdfs } from "./modules/order-receipt/order-receipt.service";
import { closeDatabasePool } from "./infrastructure/database/client/database-pool.service";

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

const server = app.listen(env.port, () => {
  logger.info(`${env.appName} is running on port ${env.port}`);

  warmNaturalReplyModel().catch((error) => {
    logger.error({ error }, "Failed to warm natural reply model");
  });

  cleanupOldOrderReceiptPdfs().catch((error) => {
    logger.error({ error }, "Failed to clean old order receipt PDFs");
  });

  if (env.whatsappProvider === "cloud_api") {
    logger.info("WhatsApp provider is Cloud API");
  } else {
    logger.error(
      { configuredProvider: env.whatsappProvider },
      "Unsupported WhatsApp provider; messaging startup disabled because Cloud API is the only active runtime transport",
    );
  }
});

let shutdownInProgress = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  logger.info({ signal }, "Shutting down backend");
  server.close(async () => {
    try {
      await closeDatabasePool();
      process.exit(0);
    } catch {
      logger.error("Database pool shutdown failed");
      process.exit(1);
    }
  });
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
