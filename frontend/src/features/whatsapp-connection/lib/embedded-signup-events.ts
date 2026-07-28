export type EmbeddedSignupCompletionAssets = Readonly<{
  wabaId: string;
  phoneNumberId: string;
}>;

export type EmbeddedSignupParsedEvent =
  | Readonly<{ kind: "finish"; assets: EmbeddedSignupCompletionAssets }>
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "error" }>;

const META_EVENT_ORIGINS = new Set(["https://www.facebook.com", "https://web.facebook.com"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseMessageData(data: unknown): UnknownRecord | null {
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isRecord(data) ? data : null;
}

export function isAllowedMetaEmbeddedSignupOrigin(origin: string): boolean {
  return META_EVENT_ORIGINS.has(origin);
}

export function parseEmbeddedSignupMessageEvent(event: MessageEvent<unknown>): EmbeddedSignupParsedEvent | null {
  if (!isAllowedMetaEmbeddedSignupOrigin(event.origin)) return null;

  const record = parseMessageData(event.data);
  if (!record || record.type !== "WA_EMBEDDED_SIGNUP") return null;

  const payload = isRecord(record.data) ? record.data : record;
  const eventName = stringField(record.event) ?? stringField(payload.event);

  if (eventName === "FINISH") {
    const wabaId = stringField(payload.waba_id) ?? stringField(record.waba_id);
    const phoneNumberId = stringField(payload.phone_number_id) ?? stringField(record.phone_number_id);
    if (!wabaId || !phoneNumberId) return null;
    return { kind: "finish", assets: { wabaId, phoneNumberId } };
  }

  if (eventName === "CANCEL") return { kind: "cancel" };
  if (eventName === "ERROR") return { kind: "error" };

  return null;
}
