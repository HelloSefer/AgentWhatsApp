export type WhatsAppQueueFailureClassification = "retryable" | "permanent" | "already_handled";

export type WhatsAppQueueFailureCategory =
  | "already_handled"
  | "invalid_job_schema"
  | "unsupported_command"
  | "invalid_prepared_payload"
  | "missing_routing_configuration"
  | "permanent_recipient_or_payload_rejection"
  | "network_interruption"
  | "timeout"
  | "temporary_queue_failure"
  | "temporary_database_failure"
  | "temporary_cloud_failure"
  | "rate_limited"
  | "unknown";

export type WhatsAppQueueFailureDecision = Readonly<{
  classification: WhatsAppQueueFailureClassification;
  category: WhatsAppQueueFailureCategory;
  summary: string;
}>;

export class WhatsAppQueueReliabilityError extends Error {
  constructor(
    public readonly category: "dlq_publish_failed" | "terminal_turn_finalize_failed" | "invalid_progress",
    cause?: unknown,
  ) {
    super(`WhatsApp queue reliability error: ${category}`);
    this.name = "WhatsAppQueueReliabilityError";
    if (cause !== undefined) this.cause = cause;
  }
}

export type WhatsAppDlqFailureEnvelope = Readonly<{
  schemaVersion: 1;
  sourceQueue: string;
  originalJobId: string;
  originalJobSchemaVersion: number | "unknown";
  sellerId: string;
  sourceIdentity: string;
  failureCategory: WhatsAppQueueFailureCategory;
  classification: Exclude<WhatsAppQueueFailureClassification, "already_handled">;
  attemptsMade: number;
  failedAt: string;
  failedCommand?: Readonly<{
    index: number;
    type: string;
  }>;
  summary: string;
}>;
