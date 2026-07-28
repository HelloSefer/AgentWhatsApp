export const WHATSAPP_CONNECTION_PROVIDER = "META_WHATSAPP_CLOUD_API" as const;

export const WHATSAPP_CONNECTION_STATUSES = [
  "PENDING",
  "VERIFYING",
  "ACTIVE",
  "REPLACEMENT_PENDING",
  "ERROR",
  "DISCONNECTED",
  "REVOKED",
] as const;

export type WhatsAppConnectionProvider = typeof WHATSAPP_CONNECTION_PROVIDER;
export type WhatsAppConnectionStatus = typeof WHATSAPP_CONNECTION_STATUSES[number];

export type WhatsAppConnection = Readonly<{
  connectionId: string;
  sellerId: string;
  provider: WhatsAppConnectionProvider;
  status: WhatsAppConnectionStatus;
  metaBusinessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  connectedAt?: Date;
  lastVerifiedAt?: Date;
  phoneRegistrationCompletedAt?: Date;
  wabaSubscriptionCompletedAt?: Date;
  finalizationLastErrorCode?: string;
  finalizationLastErrorAt?: Date;
  disconnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ActiveWhatsAppConnectionResolution = Readonly<{
  sellerId: string;
  connection: WhatsAppConnection;
}>;
