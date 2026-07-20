import pino from "pino";
import app from "./app";
import { env } from "./config/env";
import { warmNaturalReplyModel } from "./modules/agent/natural-reply/natural-reply-generator.service";
import { cleanupOldOrderReceiptPdfs } from "./modules/order-receipt/order-receipt.service";

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
