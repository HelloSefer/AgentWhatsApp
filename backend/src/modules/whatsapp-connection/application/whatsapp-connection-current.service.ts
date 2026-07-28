import type { TenantContext } from "../../../infrastructure/database";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import type { WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";

export type CurrentWhatsAppConnection = Readonly<{
  connectionId: string;
  status: WhatsAppConnectionStatus;
  maskedPhoneNumber: string | null;
  verifiedName: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  isReplacement: boolean;
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
};
