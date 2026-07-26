import type { QueueDefinition } from "../../../../infrastructure/queue";
import type {
  WhatsAppDlqFailureEnvelope,
} from "../queue-reliability/whatsapp-queue-reliability.types";
import type { WhatsAppDlqJobName, WhatsAppDlqJobResult } from "../queue-reliability/whatsapp-dlq.publisher";

export const WHATSAPP_INBOUND_DLQ_NAME = "whatsapp-inbound-dlq";

export const whatsappInboundDlqDefinition: QueueDefinition<
  WhatsAppDlqJobName,
  WhatsAppDlqFailureEnvelope,
  WhatsAppDlqJobResult
> = {
  name: WHATSAPP_INBOUND_DLQ_NAME,
  jobNames: ["whatsapp.dlq.failure"] as const,
};
