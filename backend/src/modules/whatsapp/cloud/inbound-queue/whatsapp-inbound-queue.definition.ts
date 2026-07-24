import type { JobsOptions } from "bullmq";
import type { QueueDefinition } from "../../../../infrastructure/queue";
import type { WhatsAppInboundJobData, WhatsAppInboundJobName, WhatsAppInboundJobResult } from "./whatsapp-inbound-job.types";

export const WHATSAPP_INBOUND_QUEUE_NAME = "whatsapp-inbound-queue";

/**
 * Completed jobs are retained for 2 hours with no count limit. A fixed count
 * limit would evict the oldest completed jobs during a traffic burst, defeating
 * the deduplication window for Meta webhook redeliveries. Age-only retention
 * ensures the window holds even under burst load. Two hours covers realistic
 * Meta retry patterns (typically seconds–minutes; rare edge cases up to ~1 h).
 * Failed jobs are kept indefinitely for inspection.
 */
export function whatsappInboundJobOptions(): JobsOptions {
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
