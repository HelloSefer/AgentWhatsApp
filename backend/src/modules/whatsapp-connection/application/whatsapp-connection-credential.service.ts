import type { TenantContext } from "../../../infrastructure/database";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import type { StoreWhatsAppConnectionAccessTokenInput, WhatsAppConnectionCredentialStorage } from "../domain/whatsapp-connection-credentials.types";
import type { WhatsAppConnectionCredentialEncryptionService } from "./whatsapp-connection-credential-encryption.service";

export class WhatsAppConnectionCredentialService {
  constructor(
    private readonly repository: WhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService,
  ) {}

  async storeAccessToken(tenant: TenantContext, connectionId: string, input: StoreWhatsAppConnectionAccessTokenInput): Promise<WhatsAppConnectionCredentialStorage | null> {
    const encrypted = this.encryptionService.encryptAccessToken(input.accessToken);
    return this.repository.persistAccessTokenCredential(tenant, connectionId, {
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenKeyVersion: encrypted.tokenKeyVersion,
      tokenFingerprint: encrypted.tokenFingerprint,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
    });
  }

  async getCredentialStorage(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnectionCredentialStorage | null> {
    return this.repository.findCredentialStorage(tenant, connectionId);
  }

  async decryptStoredAccessToken(tenant: TenantContext, connectionId: string): Promise<string | null> {
    const storage = await this.repository.findCredentialStorage(tenant, connectionId);
    return storage ? this.encryptionService.decryptAccessToken(storage.encryptedAccessToken) : null;
  }
}
