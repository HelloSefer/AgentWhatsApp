export type WhatsAppConnectionAuditEventName =
  | "whatsapp_connection.signup_completed"
  | "whatsapp_connection.verification_failed"
  | "whatsapp_connection.activated"
  | "whatsapp_connection.replacement_started"
  | "whatsapp_connection.replaced"
  | "whatsapp_connection.disconnected"
  | "whatsapp_connection.token_invalid"
  | "whatsapp_connection.unknown_phone_webhook";

export type WhatsAppConnectionMetricName =
  | "whatsapp_connections_active_total"
  | "whatsapp_connection_failures_total"
  | "whatsapp_connection_unknown_phone_webhooks_total"
  | "whatsapp_connection_token_failures_total"
  | "whatsapp_connection_inbound_resolution_failures_total"
  | "whatsapp_connection_outbound_resolution_failures_total"
  | "whatsapp_connection_signup_completion_duration";

export type SafeWhatsAppConnectionReason =
  | "conflict"
  | "invalid_request"
  | "verification_failed"
  | "token_invalid"
  | "missing_configuration"
  | "credential_unavailable"
  | "persistence_failure"
  | "inactive_or_unknown_phone_number_id"
  | "invalid_phone_number_id"
  | "missing_active_connection"
  | "credential_decryption_failed"
  | "missing_connection_credentials"
  | "malformed_persisted_phone_number_id";

export type WhatsAppConnectionOperationalPayload = Readonly<{
  sellerId?: string;
  connectionId?: string;
  status?: string;
  reason?: SafeWhatsAppConnectionReason;
  timestamp: string;
}>;

export type WhatsAppConnectionOperationalRecorder = Readonly<{
  recordAudit(eventName: WhatsAppConnectionAuditEventName, payload: WhatsAppConnectionOperationalPayload): void;
  increment(metricName: WhatsAppConnectionMetricName, payload?: WhatsAppConnectionOperationalPayload): void;
  observe(metricName: WhatsAppConnectionMetricName, value: number, payload?: WhatsAppConnectionOperationalPayload): void;
}>;

function timestamp(): string {
  return new Date().toISOString();
}

function safePayload(payload: Omit<WhatsAppConnectionOperationalPayload, "timestamp">): WhatsAppConnectionOperationalPayload {
  return {
    ...(payload.sellerId ? { sellerId: payload.sellerId } : {}),
    ...(payload.connectionId ? { connectionId: payload.connectionId } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    ...(payload.reason ? { reason: payload.reason } : {}),
    timestamp: timestamp(),
  };
}

function emitOperationalEvent(kind: "audit" | "metric" | "observation", name: string, payload: WhatsAppConnectionOperationalPayload, value?: number): void {
  console.info(JSON.stringify({
    event: "whatsapp_connection.operational",
    kind,
    name,
    ...(typeof value === "number" ? { value } : {}),
    ...payload,
  }));
}

let recorder: WhatsAppConnectionOperationalRecorder = {
  recordAudit: (eventName, payload) => emitOperationalEvent("audit", eventName, payload),
  increment: (metricName, payload = safePayload({})) => emitOperationalEvent("metric", metricName, payload),
  observe: (metricName, value, payload = safePayload({})) => emitOperationalEvent("observation", metricName, payload, value),
};

export function recordWhatsAppConnectionAudit(eventName: WhatsAppConnectionAuditEventName, payload: Omit<WhatsAppConnectionOperationalPayload, "timestamp">): void {
  recorder.recordAudit(eventName, safePayload(payload));
}

export function incrementWhatsAppConnectionMetric(metricName: WhatsAppConnectionMetricName, payload: Omit<WhatsAppConnectionOperationalPayload, "timestamp"> = {}): void {
  recorder.increment(metricName, safePayload(payload));
}

export function observeWhatsAppConnectionMetric(metricName: WhatsAppConnectionMetricName, value: number, payload: Omit<WhatsAppConnectionOperationalPayload, "timestamp"> = {}): void {
  recorder.observe(metricName, value, safePayload(payload));
}

export function setWhatsAppConnectionOperationalRecorderForTesting(nextRecorder: WhatsAppConnectionOperationalRecorder | undefined): void {
  recorder = nextRecorder ?? {
    recordAudit: (eventName, payload) => emitOperationalEvent("audit", eventName, payload),
    increment: (metricName, payload = safePayload({})) => emitOperationalEvent("metric", metricName, payload),
    observe: (metricName, value, payload = safePayload({})) => emitOperationalEvent("observation", metricName, payload, value),
  };
}
