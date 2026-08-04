export type DevelopmentTenantStatus = "NOT_CONFIGURED" | "CONNECTION_REQUIRED" | "COMMERCE_REQUIRED" | "READY" | "DEGRADED";

export type DevelopmentTenantReadiness = Readonly<{
  configured: boolean;
  connectionStatus?: string;
  connectionMethod?: string;
  commerceReadiness: "NOT_READY" | "READY";
  productCount: number;
  conversationConfigAvailable: boolean;
  encryptedCredentialSourceAvailable: boolean;
  receiptBrandingAvailable: boolean;
  runtimeReady: boolean;
  status: DevelopmentTenantStatus;
  blockers: readonly string[];
}>;

export type ConversationResetResult = Readonly<{ deletedKeyCount: number }>;
