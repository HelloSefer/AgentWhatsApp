import type { QueueConnectionManager, QueueJobProcessor } from "../../../../infrastructure/queue";
import { createManagedQueueWorker, type ManagedQueueWorker } from "../../../../infrastructure/queue";
import { whatsappInboundQueueDefinition } from "./whatsapp-inbound-queue.definition";
import type { WhatsAppInboundJobData, WhatsAppInboundJobResult } from "./whatsapp-inbound-job.types";
import { WhatsAppInboundJobValidationError } from "./whatsapp-inbound.errors";
import { processNormalizedCloudMessage, buildCloudAgentIdentity } from "../whatsapp-cloud.service";
import type { WhatsAppCloudIncomingMessage } from "../whatsapp-cloud.types";

function validateInboundJobData(data: unknown): WhatsAppInboundJobData {
  if (!data || typeof data !== "object") {
    throw new WhatsAppInboundJobValidationError("invalid_payload");
  }

  const record = data as Record<string, unknown>;

  if (record.schemaVersion !== 1) {
    throw new WhatsAppInboundJobValidationError("unsupported_schema");
  }

  const requiredStringFields = ["sellerId", "conversationKey", "customerPhone", "phoneNumberId", "messageId", "sourceType", "text"] as const;
  for (const field of requiredStringFields) {
    if (typeof record[field] !== "string" || !(record[field] as string).trim()) {
      throw new WhatsAppInboundJobValidationError("invalid_payload");
    }
  }

  return data as WhatsAppInboundJobData;
}

function jobDataToNormalizedMessage(data: WhatsAppInboundJobData): WhatsAppCloudIncomingMessage {
  return {
    phoneNumberId: data.phoneNumberId,
    waId: data.customerPhone,
    messageId: data.messageId,
    timestamp: data.timestamp,
    type: data.sourceType === "text" ? "text" : "interactive",
    text: data.text,
    sourceType: data.sourceType as WhatsAppCloudIncomingMessage["sourceType"],
    buttonReplyId: data.buttonReplyId,
    buttonReplyTitle: data.buttonReplyTitle,
  };
}

function createInboundProcessor(): QueueJobProcessor<WhatsAppInboundJobData, WhatsAppInboundJobResult> {
  return async (job): Promise<WhatsAppInboundJobResult> => {
    const data = validateInboundJobData(job.data);
    const message = jobDataToNormalizedMessage(data);
    const identity = buildCloudAgentIdentity({
      phoneNumberId: data.phoneNumberId,
      waId: data.customerPhone,
    });
    const result = await processNormalizedCloudMessage(message, identity, {});

    return {
      ok: result.ok,
      handled: result.handled,
    };
  };
}

export function createWhatsAppInboundWorker(
  connectionManager: QueueConnectionManager,
): ManagedQueueWorker {
  return createManagedQueueWorker(
    whatsappInboundQueueDefinition,
    createInboundProcessor(),
    connectionManager,
  );
}
