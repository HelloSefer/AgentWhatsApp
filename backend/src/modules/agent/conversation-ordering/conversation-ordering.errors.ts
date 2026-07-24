export type ConversationOrderingErrorCategory =
  | "sequence_reservation_unavailable"
  | "ordering_state_unavailable"
  | "lease_unavailable"
  | "lease_lost"
  | "invalid_sequence"
  | "unsupported_ordering_schema";

export class ConversationOrderingError extends Error {
  public readonly category: ConversationOrderingErrorCategory;
  public readonly cause?: unknown;

  constructor(category: ConversationOrderingErrorCategory, cause?: unknown) {
    super(`Conversation ordering error: ${category}`);
    this.name = "ConversationOrderingError";
    this.category = category;
    this.cause = cause;
  }
}
