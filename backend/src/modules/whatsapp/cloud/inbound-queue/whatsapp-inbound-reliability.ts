import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { ConversationOrderingError } from "../../../agent/conversation-ordering/conversation-ordering.errors";
import { DatabaseInfrastructureError } from "../../../../infrastructure/database/errors/database.errors";
import { QueueConnectionError, QueueWorkerStartupError } from "../../../../infrastructure/queue";
import { WhatsAppDlqPublisher } from "../queue-reliability/whatsapp-dlq.publisher";
import {
  type WhatsAppDlqFailureEnvelope,
  type WhatsAppQueueFailureDecision,
  WhatsAppQueueReliabilityError,
} from "../queue-reliability/whatsapp-queue-reliability.types";
import { WHATSAPP_INBOUND_QUEUE_NAME, WHATSAPP_INBOUND_RETRY_ATTEMPTS } from "./whatsapp-inbound-queue.definition";
import { WhatsAppInboundJobValidationError } from "./whatsapp-inbound.errors";
import type { WhatsAppInboundJobData, WhatsAppInboundJobResult } from "./whatsapp-inbound-job.types";

export function maskSafeIdentity(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "unknown";
  return text.length > 6 ? `${text.slice(0, 3)}***${text.slice(-3)}` : "***";
}

export function classifyInboundFailure(error: unknown): WhatsAppQueueFailureDecision {
  if (error instanceof WhatsAppInboundJobValidationError) {
    return {
      classification: "permanent",
      category: "invalid_job_schema",
      summary: error.category,
    };
  }
  if (error instanceof ConversationOrderingError) {
    return {
      classification: "retryable",
      category: "temporary_queue_failure",
      summary: error.category,
    };
  }
  if (error instanceof DatabaseInfrastructureError) {
    return {
      classification: "retryable",
      category: "temporary_database_failure",
      summary: "database_unavailable",
    };
  }
  if (error instanceof QueueConnectionError || error instanceof QueueWorkerStartupError) {
    return {
      classification: "retryable",
      category: "temporary_queue_failure",
      summary: "queue_unavailable",
    };
  }
  return {
    classification: "permanent",
    category: "unknown",
    summary: "unclassified_inbound_failure",
  };
}

export function buildInboundDlqEnvelope(
  job: Job<WhatsAppInboundJobData, WhatsAppInboundJobResult, string>,
  decision: WhatsAppQueueFailureDecision,
): WhatsAppDlqFailureEnvelope {
  const data = job.data as Partial<WhatsAppInboundJobData> | undefined;
  return {
    schemaVersion: 1,
    sourceQueue: WHATSAPP_INBOUND_QUEUE_NAME,
    originalJobId: job.id || String(data?.messageId || "unknown"),
    originalJobSchemaVersion: typeof data?.schemaVersion === "number" ? data.schemaVersion : "unknown",
    sellerId: typeof data?.sellerId === "string" ? data.sellerId : "unknown",
    sourceIdentity: maskSafeIdentity(data?.customerPhone),
    failureCategory: decision.category,
    classification: decision.classification === "retryable" ? "retryable" : "permanent",
    attemptsMade: job.attemptsMade + 1,
    failedAt: new Date().toISOString(),
    summary: decision.summary,
  };
}

export async function handleInboundFailure(
  job: Job<WhatsAppInboundJobData, WhatsAppInboundJobResult, string>,
  error: unknown,
  dlqPublisher?: WhatsAppDlqPublisher,
): Promise<never> {
  const decision = classifyInboundFailure(error);
  const attemptsMade = job.attemptsMade + 1;
  const terminal = decision.classification === "permanent" || attemptsMade >= WHATSAPP_INBOUND_RETRY_ATTEMPTS;
  if (!terminal || !dlqPublisher) {
    throw error;
  }
  try {
    await dlqPublisher.publish(buildInboundDlqEnvelope(job, decision));
  } catch (publishError) {
    throw new WhatsAppQueueReliabilityError("dlq_publish_failed", publishError);
  }
  throw new UnrecoverableError(`whatsapp_inbound_terminal:${decision.category}`);
}
