import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { DatabaseInfrastructureError } from "../../../../infrastructure/database/errors/database.errors";
import { QueueConnectionError, QueueWorkerStartupError } from "../../../../infrastructure/queue";
import { WhatsAppDlqPublisher } from "../queue-reliability/whatsapp-dlq.publisher";
import {
  type WhatsAppDlqFailureEnvelope,
  type WhatsAppQueueFailureDecision,
  WhatsAppQueueReliabilityError,
} from "../queue-reliability/whatsapp-queue-reliability.types";
import type { WhatsAppOutboundCommandType } from "./whatsapp-outbound-command.types";
import { WhatsAppOutboundError } from "./whatsapp-outbound.errors";
import type { WhatsAppOutboundJobData, WhatsAppOutboundJobResult } from "./whatsapp-outbound-job.types";
import { WHATSAPP_OUTBOUND_QUEUE_NAME, WHATSAPP_OUTBOUND_RETRY_ATTEMPTS } from "./whatsapp-outbound-queue.definition";

export type WhatsAppOutboundProgress = Readonly<{
  schemaVersion: 1;
  nextCommandIndex: number;
}>;

export function validateOutboundProgress(value: unknown, commandCount: number): WhatsAppOutboundProgress {
  if (value === 0 || value === undefined || value === null) {
    return { schemaVersion: 1, nextCommandIndex: 0 };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WhatsAppQueueReliabilityError("invalid_progress");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.nextCommandIndex !== "number" ||
    !Number.isInteger(record.nextCommandIndex) ||
    record.nextCommandIndex < 0 ||
    record.nextCommandIndex > commandCount
  ) {
    throw new WhatsAppQueueReliabilityError("invalid_progress");
  }
  return {
    schemaVersion: 1,
    nextCommandIndex: record.nextCommandIndex,
  };
}

function maskSafeIdentity(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "unknown";
  return text.length > 6 ? `${text.slice(0, 3)}***${text.slice(-3)}` : "***";
}

export function classifyOutboundFailure(error: unknown): WhatsAppQueueFailureDecision {
  if (error instanceof WhatsAppQueueReliabilityError && error.category === "invalid_progress") {
    return { classification: "permanent", category: "invalid_prepared_payload", summary: "invalid_progress" };
  }
  if (error instanceof WhatsAppOutboundError) {
    if (error.category === "outbound_transport_failed") {
      return { classification: "retryable", category: "temporary_cloud_failure", summary: error.category };
    }
    if (error.category === "outbound_queue_unavailable" || error.category === "outbound_enqueue_failed") {
      return { classification: "retryable", category: "temporary_queue_failure", summary: error.category };
    }
    if (error.category === "missing_transport_routing_identity") {
      return { classification: "permanent", category: "missing_routing_configuration", summary: error.category };
    }
    if (error.category === "unsupported_command" || error.category === "unsupported_outbound_schema") {
      return { classification: "permanent", category: "unsupported_command", summary: error.category };
    }
    return { classification: "permanent", category: "invalid_prepared_payload", summary: error.category };
  }
  if (error instanceof DatabaseInfrastructureError) {
    return { classification: "retryable", category: "temporary_database_failure", summary: "database_unavailable" };
  }
  if (error instanceof QueueConnectionError || error instanceof QueueWorkerStartupError) {
    return { classification: "retryable", category: "temporary_queue_failure", summary: "queue_unavailable" };
  }
  return { classification: "permanent", category: "unknown", summary: "unclassified_outbound_failure" };
}

export function buildOutboundDlqEnvelope(
  job: Job<WhatsAppOutboundJobData, WhatsAppOutboundJobResult, string>,
  decision: WhatsAppQueueFailureDecision,
  failedCommand?: Readonly<{ index: number; type: WhatsAppOutboundCommandType }>,
): WhatsAppDlqFailureEnvelope {
  const data = job.data as Partial<WhatsAppOutboundJobData> | undefined;
  return {
    schemaVersion: 1,
    sourceQueue: WHATSAPP_OUTBOUND_QUEUE_NAME,
    originalJobId: job.id || String(data?.responseGroupId || "unknown"),
    originalJobSchemaVersion: typeof data?.schemaVersion === "number" ? data.schemaVersion : "unknown",
    sellerId: typeof data?.sellerId === "string" ? data.sellerId : "unknown",
    sourceIdentity: maskSafeIdentity(data?.recipient?.waId),
    failureCategory: decision.category,
    classification: decision.classification === "retryable" ? "retryable" : "permanent",
    attemptsMade: job.attemptsMade + 1,
    failedAt: new Date().toISOString(),
    ...(failedCommand ? { failedCommand } : {}),
    summary: decision.summary,
  };
}

export async function handleOutboundFailure(
  job: Job<WhatsAppOutboundJobData, WhatsAppOutboundJobResult, string>,
  error: unknown,
  dlqPublisher?: WhatsAppDlqPublisher,
  failedCommand?: Readonly<{ index: number; type: WhatsAppOutboundCommandType }>,
): Promise<never> {
  const decision = classifyOutboundFailure(error);
  const attemptsMade = job.attemptsMade + 1;
  const terminal = decision.classification === "permanent" || attemptsMade >= WHATSAPP_OUTBOUND_RETRY_ATTEMPTS;
  if (!terminal || !dlqPublisher) {
    throw error;
  }
  try {
    await dlqPublisher.publish(buildOutboundDlqEnvelope(job, decision, failedCommand));
  } catch (publishError) {
    throw new WhatsAppQueueReliabilityError("dlq_publish_failed", publishError);
  }
  throw new UnrecoverableError(`whatsapp_outbound_terminal:${decision.category}`);
}
