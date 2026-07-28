import type { TenantContext } from "../../../infrastructure/database";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import type { WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";

export type WhatsAppConnectionHealthStatus =
  | "HEALTHY"
  | "SETUP_IN_PROGRESS"
  | "ACTION_REQUIRED"
  | "DISCONNECTED"
  | "REVOKED"
  | "UNKNOWN";

export type WhatsAppConnectionSafeIssueCode =
  | "TOKEN_INVALID"
  | "REGISTRATION_INCOMPLETE"
  | "WEBHOOK_SUBSCRIPTION_INCOMPLETE"
  | "META_PERMISSION_REQUIRED"
  | "CONNECTION_DISCONNECTED"
  | "CONNECTION_REVOKED"
  | "VERIFICATION_FAILED";

export type CurrentWhatsAppConnection = Readonly<{
  connectionId: string;
  status: WhatsAppConnectionStatus;
  maskedPhoneNumber: string | null;
  verifiedName: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  isReplacement: boolean;
  healthStatus: WhatsAppConnectionHealthStatus;
  safeIssueCode: WhatsAppConnectionSafeIssueCode | null;
}>;

export type CurrentWhatsAppConnectionResult = Readonly<{
  connection: CurrentWhatsAppConnection | null;
}>;

const CURRENT_STATUS_PRIORITY: Readonly<Record<WhatsAppConnectionStatus, number>> = {
  ACTIVE: 0,
  REPLACEMENT_PENDING: 1,
  VERIFYING: 2,
  PENDING: 3,
  ERROR: 4,
  DISCONNECTED: 5,
  REVOKED: 6,
};

function isoDate(value: Date | undefined): string | null {
  return value ? value.toISOString() : null;
}

function maskPhoneNumber(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 4) return "••••";
  return `${"•".repeat(Math.min(8, Math.max(4, digits.length - 4)))}${digits.slice(-4)}`;
}

function compareCurrentConnection(left: WhatsAppConnection, right: WhatsAppConnection): number {
  const priority = CURRENT_STATUS_PRIORITY[left.status] - CURRENT_STATUS_PRIORITY[right.status];
  if (priority !== 0) return priority;
  return right.createdAt.getTime() - left.createdAt.getTime();
}

function safeIssueCode(connection: WhatsAppConnection): WhatsAppConnectionSafeIssueCode | null {
  if (connection.status === "DISCONNECTED") return "CONNECTION_DISCONNECTED";
  if (connection.status === "REVOKED") return "CONNECTION_REVOKED";
  if (connection.finalizationLastErrorCode === "invalid_access_token" || connection.finalizationLastErrorCode === "missing_access_token") return "TOKEN_INVALID";
  if (connection.finalizationLastErrorCode === "meta_permission_denied") return "META_PERMISSION_REQUIRED";
  if (connection.status === "ERROR") return "VERIFICATION_FAILED";
  if ((connection.status === "VERIFYING" || connection.status === "REPLACEMENT_PENDING") && !connection.phoneRegistrationCompletedAt) return "REGISTRATION_INCOMPLETE";
  if ((connection.status === "VERIFYING" || connection.status === "REPLACEMENT_PENDING") && !connection.wabaSubscriptionCompletedAt) return "WEBHOOK_SUBSCRIPTION_INCOMPLETE";
  if (connection.finalizationLastErrorCode) return "VERIFICATION_FAILED";
  return null;
}

function healthStatus(connection: WhatsAppConnection): WhatsAppConnectionHealthStatus {
  if (connection.status === "ACTIVE") return safeIssueCode(connection) ? "ACTION_REQUIRED" : "HEALTHY";
  if (connection.status === "PENDING" || connection.status === "VERIFYING" || connection.status === "REPLACEMENT_PENDING") return "SETUP_IN_PROGRESS";
  if (connection.status === "ERROR") return "ACTION_REQUIRED";
  if (connection.status === "DISCONNECTED") return "DISCONNECTED";
  if (connection.status === "REVOKED") return "REVOKED";
  return "UNKNOWN";
}

function safeConnection(connection: WhatsAppConnection): CurrentWhatsAppConnection {
  return {
    connectionId: connection.connectionId,
    status: connection.status,
    maskedPhoneNumber: maskPhoneNumber(connection.displayPhoneNumber),
    verifiedName: connection.verifiedName ?? null,
    connectedAt: isoDate(connection.connectedAt),
    lastVerifiedAt: isoDate(connection.lastVerifiedAt),
    disconnectedAt: isoDate(connection.disconnectedAt),
    isReplacement: connection.status === "REPLACEMENT_PENDING" || Boolean(connection.replacedConnectionId),
    healthStatus: healthStatus(connection),
    safeIssueCode: safeIssueCode(connection),
  };
}

export class WhatsAppConnectionCurrentService {
  constructor(private readonly repository: WhatsAppConnectionRepository) {}

  async getCurrent(tenant: TenantContext): Promise<CurrentWhatsAppConnectionResult> {
    const active = await this.repository.findActiveBySeller(tenant);
    if (active) return { connection: safeConnection(active) };

    const all = await this.repository.findAllForSeller(tenant);
    const selected = [...all].sort(compareCurrentConnection)[0] ?? null;
    return { connection: selected ? safeConnection(selected) : null };
  }
}

export const __phase11iCurrentTesting = {
  maskPhoneNumber,
  safeIssueCode,
  healthStatus,
};
