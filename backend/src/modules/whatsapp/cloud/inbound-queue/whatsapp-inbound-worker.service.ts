import { DelayedError } from "bullmq";
import type { Job } from "bullmq";
import type { QueueConnectionManager, QueueDefinition, QueueJobProcessor } from "../../../../infrastructure/queue";
import { createManagedQueueWorker, type ManagedQueueWorker } from "../../../../infrastructure/queue";
import {
  CONVERSATION_ORDERING_DEFER_MS,
  CONVERSATION_ORDERING_RENEW_INTERVAL_MS,
  type ConversationOrderingCoordinator,
  type ConversationTurnClaim,
} from "../../../agent/conversation-ordering";
import { whatsappInboundQueueDefinition } from "./whatsapp-inbound-queue.definition";
import type { WhatsAppInboundJobData, WhatsAppInboundJobResult } from "./whatsapp-inbound-job.types";
import { WhatsAppInboundJobValidationError } from "./whatsapp-inbound.errors";
import { processNormalizedCloudMessage, buildCloudAgentIdentity, type CloudPreparedResponseGroupDispatcher } from "../whatsapp-cloud.service";
import type { WhatsAppCloudIncomingMessage } from "../whatsapp-cloud.types";

function validateInboundJobData(data: unknown): WhatsAppInboundJobData {
  if (!data || typeof data !== "object") {
    throw new WhatsAppInboundJobValidationError("invalid_payload");
  }

  const record = data as Record<string, unknown>;

  if (record.schemaVersion !== 1 && record.schemaVersion !== 2) {
    throw new WhatsAppInboundJobValidationError("unsupported_schema");
  }

  const requiredStringFields = ["sellerId", "conversationKey", "customerPhone", "phoneNumberId", "messageId", "sourceType", "text"] as const;
  for (const field of requiredStringFields) {
    if (typeof record[field] !== "string" || !(record[field] as string).trim()) {
      throw new WhatsAppInboundJobValidationError("invalid_payload");
    }
  }

  if (record.schemaVersion === 2) {
    const ordering = record.ordering as Record<string, unknown> | undefined;
    if (
      !ordering ||
      ordering.version !== 1 ||
      typeof ordering.orderingKey !== "string" ||
      !ordering.orderingKey.trim() ||
      typeof ordering.sequence !== "number" ||
      !Number.isInteger(ordering.sequence) ||
      ordering.sequence < 1
    ) {
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

function startLeaseRenewal(
  coordinator: ConversationOrderingCoordinator,
  claim: ConversationTurnClaim,
): Readonly<{ stop: () => void; lost: () => boolean }> {
  let stopped = false;
  let lostLease = false;
  const timer = setInterval(() => {
    void coordinator.renewTurnLease(claim).then((result) => {
      if (result.status !== "renewed") lostLease = true;
    }).catch(() => {
      lostLease = true;
    });
  }, CONVERSATION_ORDERING_RENEW_INTERVAL_MS);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
    lost: () => lostLease,
  };
}

async function processValidatedJob(
  data: WhatsAppInboundJobData,
  options: Readonly<{ groupDispatcher?: CloudPreparedResponseGroupDispatcher }> = {},
): Promise<WhatsAppInboundJobResult> {
  const message = jobDataToNormalizedMessage(data);
  const identity = buildCloudAgentIdentity({
    phoneNumberId: data.phoneNumberId,
    waId: data.customerPhone,
  });
  const result = await processNormalizedCloudMessage(message, identity, {
    preparedResponseGroupDispatcher: options.groupDispatcher,
  });

  return {
    ok: result.ok,
    handled: result.handled,
  };
}

async function deferAheadOfTurnJob(job: Job<WhatsAppInboundJobData, WhatsAppInboundJobResult, string>): Promise<WhatsAppInboundJobResult> {
  await job.moveToDelayed(Date.now() + CONVERSATION_ORDERING_DEFER_MS, job.token);
  throw new DelayedError("conversation_turn_not_ready");
}

function createInboundProcessor(
  orderingCoordinator?: ConversationOrderingCoordinator,
  options: Readonly<{ groupDispatcher?: CloudPreparedResponseGroupDispatcher }> = {},
): QueueJobProcessor<WhatsAppInboundJobData, WhatsAppInboundJobResult> {
  return async (job): Promise<WhatsAppInboundJobResult> => {
    const data = validateInboundJobData(job.data);

    if (data.schemaVersion !== 2 || !orderingCoordinator) {
      return processValidatedJob(data, options);
    }

    const claimResult = await orderingCoordinator.tryClaimTurn(
      {
        orderingKey: data.ordering.orderingKey,
        sequence: data.ordering.sequence,
      },
      job.id || data.messageId,
    );

    if (claimResult.status === "alreadyCompleted") {
      return { ok: true, handled: false, alreadyCompleted: true };
    }
    if (claimResult.status !== "claimed") {
      return deferAheadOfTurnJob(job);
    }

    const renewal = startLeaseRenewal(orderingCoordinator, claimResult.claim);
    try {
      const result = await processValidatedJob(data, options);
      if (renewal.lost()) {
        throw new Error("conversation_ordering_lease_lost");
      }
      const completeResult = await orderingCoordinator.completeTurn(claimResult.claim);
      if (completeResult.status === "lostLease") {
        throw new Error("conversation_ordering_lease_lost");
      }
      return result;
    } catch (error) {
      await orderingCoordinator.releaseTurn(claimResult.claim);
      throw error;
    } finally {
      renewal.stop();
    }
  };
}

export function createWhatsAppInboundWorker(
  connectionManager: QueueConnectionManager,
  orderingCoordinator?: ConversationOrderingCoordinator,
  options: Readonly<{
    concurrency?: number;
    groupDispatcher?: CloudPreparedResponseGroupDispatcher;
  }> = {},
  queueDefinition: QueueDefinition<"whatsapp-inbound.process", WhatsAppInboundJobData, WhatsAppInboundJobResult> = whatsappInboundQueueDefinition,
): ManagedQueueWorker {
  return createManagedQueueWorker(
    queueDefinition,
    createInboundProcessor(orderingCoordinator, {
      groupDispatcher: options.groupDispatcher,
    }),
    connectionManager,
    options,
  );
}
