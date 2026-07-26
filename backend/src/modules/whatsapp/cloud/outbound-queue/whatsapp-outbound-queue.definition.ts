import type { JobsOptions } from "bullmq";
import type { QueueDefinition } from "../../../../infrastructure/queue";
import { env } from "../../../../config/env";
import type { WhatsAppOutboundJobData, WhatsAppOutboundJobName, WhatsAppOutboundJobResult } from "./whatsapp-outbound-job.types";

export const WHATSAPP_OUTBOUND_QUEUE_NAME = "whatsapp-outbound-queue";
export const WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS = 10800;
export const WHATSAPP_OUTBOUND_RETRY_ATTEMPTS = 5;
export const WHATSAPP_OUTBOUND_RETRY_BACKOFF_MS = 1_000;

export function whatsappOutboundJobOptions(): JobsOptions {
  if (env.whatsappQueueRetriesDlqEnabled === true) {
    return {
      attempts: WHATSAPP_OUTBOUND_RETRY_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: WHATSAPP_OUTBOUND_RETRY_BACKOFF_MS,
      },
      removeOnComplete: { age: WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS },
      removeOnFail: false,
    };
  }
  return {
    attempts: 1,
    removeOnComplete: { age: WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS },
    removeOnFail: false,
  };
}

export const whatsappOutboundQueueDefinition: QueueDefinition<
  WhatsAppOutboundJobName,
  WhatsAppOutboundJobData,
  WhatsAppOutboundJobResult
> = {
  name: WHATSAPP_OUTBOUND_QUEUE_NAME,
  jobNames: ["whatsapp-outbound.dispatch"] as const,
};
