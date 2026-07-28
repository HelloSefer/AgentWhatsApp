import { createTenantContext } from "../../../../infrastructure/database";
import type { WhatsAppConnectionRepository } from "../../../whatsapp-connection";
import { WhatsAppConnectionCredentialEncryptionError, WhatsAppConnectionCredentialService } from "../../../whatsapp-connection";
import { incrementWhatsAppConnectionMetric, recordWhatsAppConnectionAudit } from "../../../whatsapp-connection/application/whatsapp-connection-operational-events";
import { WhatsAppOutboundError } from "../outbound-queue/whatsapp-outbound.errors";

export type ResolvedWhatsAppOutboundConnection = Readonly<{
  sellerId: string;
  connectionId: string;
  phoneNumberId: string;
  accessToken: string;
}>;

export type WhatsAppOutboundConnectionResolver = Readonly<{
  resolveForTrustedSeller: (
    sellerId: string,
  ) => Promise<ResolvedWhatsAppOutboundConnection>;
}>;

function validatePersistedPhoneNumberId(value: string | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]{5,32}$/u.test(normalized)) {
    throw new WhatsAppOutboundError("malformed_persisted_phone_number_id");
  }
  return normalized;
}

export class PersistentWhatsAppOutboundConnectionResolver implements WhatsAppOutboundConnectionResolver {
  constructor(
    private readonly repository: WhatsAppConnectionRepository,
    private readonly credentialService: WhatsAppConnectionCredentialService,
  ) {}

  async resolveForTrustedSeller(sellerId: string): Promise<ResolvedWhatsAppOutboundConnection> {
    const tenant = createTenantContext(sellerId);
    const connection = await this.repository.findActiveBySeller(tenant);
    if (!connection) {
      incrementWhatsAppConnectionMetric("whatsapp_connection_outbound_resolution_failures_total", { sellerId: tenant.sellerId, reason: "missing_active_connection" });
      throw new WhatsAppOutboundError("missing_active_connection");
    }

    let phoneNumberId: string;
    try {
      phoneNumberId = validatePersistedPhoneNumberId(connection.phoneNumberId);
    } catch (error) {
      incrementWhatsAppConnectionMetric("whatsapp_connection_outbound_resolution_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "malformed_persisted_phone_number_id" });
      throw error;
    }
    let accessToken: string | null;
    try {
      accessToken = await this.credentialService.decryptStoredAccessToken(
        tenant,
        connection.connectionId,
      );
    } catch (error) {
      if (error instanceof WhatsAppConnectionCredentialEncryptionError) {
        recordWhatsAppConnectionAudit("whatsapp_connection.token_invalid", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "credential_decryption_failed" });
        incrementWhatsAppConnectionMetric("whatsapp_connection_token_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "credential_decryption_failed" });
        incrementWhatsAppConnectionMetric("whatsapp_connection_outbound_resolution_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "credential_decryption_failed" });
        throw new WhatsAppOutboundError("credential_decryption_failed");
      }
      throw error;
    }

    if (!accessToken) {
      recordWhatsAppConnectionAudit("whatsapp_connection.token_invalid", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "missing_connection_credentials" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_token_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "missing_connection_credentials" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_outbound_resolution_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "missing_connection_credentials" });
      throw new WhatsAppOutboundError("missing_connection_credentials");
    }

    return {
      sellerId: tenant.sellerId,
      connectionId: connection.connectionId,
      phoneNumberId,
      accessToken,
    };
  }
}
