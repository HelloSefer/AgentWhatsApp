import pino from "pino";
import app from "./app";
import { env } from "./config/env";
import { warmNaturalReplyModel } from "./modules/agent/natural-reply/natural-reply-generator.service";
import { cleanupOldOrderReceiptPdfs } from "./modules/order-receipt/order-receipt.service";
import { startWhatsApp } from "./modules/whatsapp/whatsapp.service";

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
    logger.info("WhatsApp provider is Cloud API; Baileys socket startup skipped");
  } else {
    startWhatsApp().catch((error) => {
      logger.error({ error }, "Failed to start WhatsApp");
    });
  }
});
