import { WhatsAppConnectionPersistenceError } from "../../domain/whatsapp-connection.errors";
import { WHATSAPP_CONNECTION_PROVIDER, WHATSAPP_CONNECTION_STATUSES, type WhatsAppConnection } from "../../domain/whatsapp-connection.types";

export type WhatsAppConnectionRow = Readonly<{
  connection_id: string;
  seller_id: string;
  provider: string;
  status: string;
  meta_business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  connected_at: Date | string | null;
  last_verified_at: Date | string | null;
  phone_registration_completed_at: Date | string | null;
  waba_subscription_completed_at: Date | string | null;
  finalization_last_error_code: string | null;
  finalization_last_error_at: Date | string | null;
  disconnected_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}>;

function date(value: Date | string | null): Date | undefined {
  if (value === null) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new WhatsAppConnectionPersistenceError();
  return parsed;
}

function requiredDate(value: Date | string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new WhatsAppConnectionPersistenceError();
  return parsed;
}

export function mapWhatsAppConnection(row: WhatsAppConnectionRow): WhatsAppConnection {
  if (row.provider !== WHATSAPP_CONNECTION_PROVIDER || !WHATSAPP_CONNECTION_STATUSES.includes(row.status as never)) {
    throw new WhatsAppConnectionPersistenceError();
  }

  return {
    connectionId: row.connection_id,
    sellerId: row.seller_id,
    provider: WHATSAPP_CONNECTION_PROVIDER,
    status: row.status as WhatsAppConnection["status"],
    metaBusinessId: row.meta_business_id ?? undefined,
    wabaId: row.waba_id ?? undefined,
    phoneNumberId: row.phone_number_id ?? undefined,
    displayPhoneNumber: row.display_phone_number ?? undefined,
    verifiedName: row.verified_name ?? undefined,
    connectedAt: date(row.connected_at),
    lastVerifiedAt: date(row.last_verified_at),
    phoneRegistrationCompletedAt: date(row.phone_registration_completed_at),
    wabaSubscriptionCompletedAt: date(row.waba_subscription_completed_at),
    finalizationLastErrorCode: row.finalization_last_error_code ?? undefined,
    finalizationLastErrorAt: date(row.finalization_last_error_at),
    disconnectedAt: date(row.disconnected_at),
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
  };
}
