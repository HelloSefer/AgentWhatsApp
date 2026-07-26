import pino from "pino";
import { createServer } from "node:http";
import app from "./app";
import { env } from "./config/env";
import { warmNaturalReplyModel } from "./modules/agent/natural-reply/natural-reply-generator.service";
import { cleanupOldOrderReceiptPdfs } from "./modules/order-receipt/order-receipt.service";
import { closeDatabasePool } from "./infrastructure/database/client/database-pool.service";
import { startWhatsAppInboundQueue, shutdownWhatsAppInboundQueue } from "./composition/queue/whatsapp-inbound-queue.composition";
import { closeValkeyClient } from "./infrastructure/valkey/valkey.client";

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

const server = createServer(app);

async function start(): Promise<void> {
  warmNaturalReplyModel().catch((error) => {
    logger.error({ error }, "Failed to warm natural reply model");
  });

  cleanupOldOrderReceiptPdfs().catch((error) => {
    logger.error({ error }, "Failed to clean old order receipt PDFs");
  });

  if (env.whatsappProvider === "cloud_api") {
    logger.info("WhatsApp provider is Cloud API");

    await startWhatsAppInboundQueue();
    if (env.whatsappInboundQueueEnabled === true) {
      logger.info("WhatsApp Phase 8 queued runtime started");
    }
  } else {
    logger.error(
      { configuredProvider: env.whatsappProvider },
      "Unsupported WhatsApp provider; messaging startup disabled because Cloud API is the only active runtime transport",
    );
  }

  server.listen(env.port, () => {
    logger.info(`${env.appName} is running on port ${env.port}`);
  });
}

let shutdownInProgress = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  logger.info({ signal }, "Shutting down backend");
  server.close(async () => {
    try {
      await shutdownWhatsAppInboundQueue();
      await closeValkeyClient();
      await closeDatabasePool();
      process.exit(0);
    } catch {
      logger.error("Backend shutdown failed");
      process.exit(1);
    }
  });
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

start().catch(async (error) => {
  logger.error({ error }, "Backend startup failed");
  await shutdownWhatsAppInboundQueue();
  await closeValkeyClient();
  await closeDatabasePool();
  process.exit(1);
});
