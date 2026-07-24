export type WhatsAppInboundEnqueueErrorCategory =
  | "enqueue_failed"
  | "queue_unavailable";

export type WhatsAppInboundJobValidationErrorCategory =
  | "invalid_payload"
  | "unsupported_schema";

export class WhatsAppInboundEnqueueError extends Error {
  public readonly category: WhatsAppInboundEnqueueErrorCategory;
  public readonly cause?: unknown;

  constructor(category: WhatsAppInboundEnqueueErrorCategory, cause?: unknown) {
    super(`WhatsApp inbound enqueue error: ${category}`);
    this.name = "WhatsAppInboundEnqueueError";
    this.category = category;
    this.cause = cause;
  }
}

export class WhatsAppInboundJobValidationError extends Error {
  public readonly category: WhatsAppInboundJobValidationErrorCategory;

  constructor(category: WhatsAppInboundJobValidationErrorCategory) {
    super(`WhatsApp inbound job validation error: ${category}`);
    this.name = "WhatsAppInboundJobValidationError";
    this.category = category;
  }
}
