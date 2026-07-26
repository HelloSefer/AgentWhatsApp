import type { JobsOptions } from "bullmq";
import type { QueueDefinition } from "../../../../infrastructure/queue";
import { env } from "../../../../config/env";
import type { WhatsAppInboundJobData, WhatsAppInboundJobName, WhatsAppInboundJobResult } from "./whatsapp-inbound-job.types";

export const WHATSAPP_INBOUND_QUEUE_NAME = "whatsapp-inbound-queue";
export const WHATSAPP_INBOUND_RETRY_ATTEMPTS = 3;
export const WHATSAPP_INBOUND_RETRY_BACKOFF_MS = 250;

/**
 * Completed jobs are retained for 2 hours with no count limit. A fixed count
 * limit would evict the oldest completed jobs during a traffic burst, defeating
 * the deduplication window for Meta webhook redeliveries. Age-only retention
 * ensures the window holds even under burst load. Two hours covers realistic
 * Meta retry patterns (typically seconds–minutes; rare edge cases up to ~1 h).
 * Failed jobs are kept indefinitely for inspection.
 */
export function whatsappInboundJobOptions(): JobsOptions {
  if (env.whatsappQueueRetriesDlqEnabled === true) {
    return {
      attempts: WHATSAPP_INBOUND_RETRY_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: WHATSAPP_INBOUND_RETRY_BACKOFF_MS,
      },
      removeOnComplete: { age: 7200 },
      removeOnFail: false,
    };
  }
  return {
    attempts: 1,
    removeOnComplete: { age: 7200 },
    removeOnFail: false,
  };
}

export const whatsappInboundQueueDefinition: QueueDefinition<
  WhatsAppInboundJobName,
  WhatsAppInboundJobData,
  WhatsAppInboundJobResult
> = {
  name: WHATSAPP_INBOUND_QUEUE_NAME,
  jobNames: ["whatsapp-inbound.process"] as const,
};
