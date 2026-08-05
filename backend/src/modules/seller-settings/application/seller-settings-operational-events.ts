import type { SellerSettingsChangedSection } from "./seller-settings.types";

export type SellerSettingsAuditEventName =
  | "seller_settings.updated"
  | "seller_settings.authorization_failed"
  | "seller_settings.validation_failed";

export type SellerSettingsOperationalPayload = Readonly<{
  role?: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
  changedSections?: readonly SellerSettingsChangedSection[];
  result?: "success" | "forbidden" | "invalid_request";
  issueCodes?: readonly string[];
  timestamp: string;
}>;

export type SellerSettingsOperationalRecorder = Readonly<{
  recordAudit(eventName: SellerSettingsAuditEventName, payload: SellerSettingsOperationalPayload): void;
}>;

function timestamp(): string {
  return new Date().toISOString();
}

function safePayload(payload: Omit<SellerSettingsOperationalPayload, "timestamp">): SellerSettingsOperationalPayload {
  return {
    ...(payload.role ? { role: payload.role } : {}),
    ...(payload.changedSections ? { changedSections: [...payload.changedSections] } : {}),
    ...(payload.result ? { result: payload.result } : {}),
    ...(payload.issueCodes ? { issueCodes: [...payload.issueCodes].slice(0, 20) } : {}),
    timestamp: timestamp(),
  };
}

let recorder: SellerSettingsOperationalRecorder = {
  recordAudit: (eventName, payload) => {
    console.info(JSON.stringify({
      event: "seller_settings.operational",
      kind: "audit",
      name: eventName,
      ...payload,
    }));
  },
};

export function recordSellerSettingsAudit(
  eventName: SellerSettingsAuditEventName,
  payload: Omit<SellerSettingsOperationalPayload, "timestamp">,
): void {
  recorder.recordAudit(eventName, safePayload(payload));
}

export function setSellerSettingsOperationalRecorderForTesting(nextRecorder: SellerSettingsOperationalRecorder | undefined): void {
  recorder = nextRecorder ?? {
    recordAudit: (eventName, payload) => {
      console.info(JSON.stringify({
        event: "seller_settings.operational",
        kind: "audit",
        name: eventName,
        ...payload,
      }));
    },
  };
}
