import type { JobsOptions } from "bullmq";
import type { QueueDefinition } from "../../../../infrastructure/queue";
import type { WhatsAppOutboundJobData, WhatsAppOutboundJobName, WhatsAppOutboundJobResult } from "./whatsapp-outbound-job.types";

export const WHATSAPP_OUTBOUND_QUEUE_NAME = "whatsapp-outbound-queue";
export const WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS = 10800;

export function whatsappOutboundJobOptions(): JobsOptions {
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
