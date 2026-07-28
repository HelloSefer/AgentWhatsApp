export type WhatsAppOutboundErrorCategory =
  | "invalid_outbound_group"
  | "unsupported_outbound_schema"
  | "unsupported_command"
  | "outbound_queue_unavailable"
  | "outbound_enqueue_failed"
  | "outbound_transport_failed"
  | "outbound_transport_permanent_failed"
  | "missing_transport_routing_identity"
  | "missing_artifact_reference"
  | "missing_active_connection"
  | "missing_connection_credentials"
  | "credential_decryption_failed"
  | "malformed_persisted_phone_number_id";

export class WhatsAppOutboundError extends Error {
  constructor(
    public readonly category: WhatsAppOutboundErrorCategory,
    cause?: unknown,
  ) {
    super(`WhatsApp outbound queue error: ${category}`);
    this.name = "WhatsAppOutboundError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
