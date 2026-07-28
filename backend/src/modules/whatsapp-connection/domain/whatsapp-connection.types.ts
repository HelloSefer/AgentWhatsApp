export const WHATSAPP_CONNECTION_PROVIDER = "META_WHATSAPP_CLOUD_API" as const;
export const WHATSAPP_CONNECTION_METHODS = [
  "EMBEDDED_SIGNUP",
  "CUSTOMER_OWNED_META_APP",
] as const;

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
export type WhatsAppConnectionMethod = typeof WHATSAPP_CONNECTION_METHODS[number];
export type WhatsAppConnectionStatus = typeof WHATSAPP_CONNECTION_STATUSES[number];

export type WhatsAppConnection = Readonly<{
  connectionId: string;
  sellerId: string;
  provider: WhatsAppConnectionProvider;
  connectionMethod?: WhatsAppConnectionMethod;
  status: WhatsAppConnectionStatus;
  metaAppId?: string;
  publicWebhookId?: string;
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
  replacedConnectionId?: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ActiveWhatsAppConnectionResolution = Readonly<{
  sellerId: string;
  connection: WhatsAppConnection;
}>;
