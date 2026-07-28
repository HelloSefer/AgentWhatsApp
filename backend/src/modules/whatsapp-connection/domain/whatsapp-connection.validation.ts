import { WhatsAppConnectionValidationError } from "./whatsapp-connection.errors";
import { WHATSAPP_CONNECTION_STATUSES, type WhatsAppConnectionStatus } from "./whatsapp-connection.types";

const CONNECTION_ID_MAX_LENGTH = 64;
const META_ID_MAX_LENGTH = 128;
const DISPLAY_PHONE_MAX_LENGTH = 64;

function normalizeRequired(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new WhatsAppConnectionValidationError();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new WhatsAppConnectionValidationError();
  return trimmed;
}

export function normalizeOptionalWhatsAppConnectionText(value: string | null | undefined, maxLength = META_ID_MAX_LENGTH): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = normalizeRequired(value, maxLength);
  return trimmed;
}

export function normalizeConnectionId(value: unknown): string {
  return normalizeRequired(value, CONNECTION_ID_MAX_LENGTH);
}

export function normalizeMetaId(value: string | null | undefined): string | undefined {
  return normalizeOptionalWhatsAppConnectionText(value, META_ID_MAX_LENGTH);
}

export function normalizeDisplayPhoneNumber(value: string | null | undefined): string | undefined {
  return normalizeOptionalWhatsAppConnectionText(value, DISPLAY_PHONE_MAX_LENGTH);
}

export function validateWhatsAppConnectionStatus(value: unknown): WhatsAppConnectionStatus {
  if (typeof value !== "string" || !WHATSAPP_CONNECTION_STATUSES.includes(value as WhatsAppConnectionStatus)) {
    throw new WhatsAppConnectionValidationError();
  }
  return value as WhatsAppConnectionStatus;
}
