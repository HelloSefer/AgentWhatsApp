import { ManualWebhookConfigurationError } from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseSignedWebhookBody(rawBody: Buffer | undefined): unknown {
  if (!rawBody || rawBody.byteLength === 0) throw new ManualWebhookConfigurationError("WEBHOOK_PAYLOAD_INVALID");
  try {
    return JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw new ManualWebhookConfigurationError("WEBHOOK_PAYLOAD_INVALID");
  }
}

export function assertManualWebhookPayloadOwnership(connection: WhatsAppConnection, body: unknown): void {
  if (!isRecord(body) || body.object !== "whatsapp_business_account") throw new ManualWebhookConfigurationError("WEBHOOK_PAYLOAD_INVALID");
  const entries = Array.isArray(body.entry) ? body.entry : [];
  if (!entries.length) throw new ManualWebhookConfigurationError("WEBHOOK_PAYLOAD_INVALID");
  for (const entry of entries) {
    if (!isRecord(entry)) throw new ManualWebhookConfigurationError("WEBHOOK_PAYLOAD_INVALID");
    const entryId = stringField(entry.id);
    if (entryId && connection.wabaId && entryId !== connection.wabaId) throw new ManualWebhookConfigurationError("WEBHOOK_CONNECTION_MISMATCH");
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!isRecord(change)) throw new ManualWebhookConfigurationError("WEBHOOK_PAYLOAD_INVALID");
      const value = isRecord(change.value) ? change.value : {};
      const metadata = isRecord(value.metadata) ? value.metadata : {};
      const phoneNumberId = stringField(metadata.phone_number_id);
      if (phoneNumberId && phoneNumberId !== connection.phoneNumberId) throw new ManualWebhookConfigurationError("WEBHOOK_CONNECTION_MISMATCH");
    }
  }
}

