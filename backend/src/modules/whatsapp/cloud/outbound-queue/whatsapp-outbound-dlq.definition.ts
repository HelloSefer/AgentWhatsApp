import type { QueueDefinition } from "../../../../infrastructure/queue";
import type {
  WhatsAppDlqFailureEnvelope,
} from "../queue-reliability/whatsapp-queue-reliability.types";
import type { WhatsAppDlqJobName, WhatsAppDlqJobResult } from "../queue-reliability/whatsapp-dlq.publisher";

export const WHATSAPP_OUTBOUND_DLQ_NAME = "whatsapp-outbound-dlq";

export const whatsappOutboundDlqDefinition: QueueDefinition<
  WhatsAppDlqJobName,
  WhatsAppDlqFailureEnvelope,
  WhatsAppDlqJobResult
> = {
  name: WHATSAPP_OUTBOUND_DLQ_NAME,
  jobNames: ["whatsapp.dlq.failure"] as const,
};
