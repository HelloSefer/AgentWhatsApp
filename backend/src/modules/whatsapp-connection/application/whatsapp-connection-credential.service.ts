import type { TenantContext } from "../../../infrastructure/database";
import type { WhatsAppConnectionRepository, WhatsAppConnectionRepositoryOptions } from "../contracts/whatsapp-connection.repository";
import type { StoreWhatsAppConnectionAccessTokenInput, WhatsAppConnectionCredentialStorage, WhatsAppConnectionRegistrationPinStorage } from "../domain/whatsapp-connection-credentials.types";
import type { WhatsAppConnectionCredentialEncryptionService } from "./whatsapp-connection-credential-encryption.service";

export class WhatsAppConnectionCredentialService {
  constructor(
    private readonly repository: WhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService,
  ) {}

  async storeAccessToken(tenant: TenantContext, connectionId: string, input: StoreWhatsAppConnectionAccessTokenInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionCredentialStorage | null> {
    const encrypted = this.encryptionService.encryptAccessToken(input.accessToken);
    return this.repository.persistAccessTokenCredential(tenant, connectionId, {
      encryptedAccessToken: encrypted.encryptedAccessToken,
      tokenKeyVersion: encrypted.tokenKeyVersion,
      tokenFingerprint: encrypted.tokenFingerprint,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
    }, options);
  }

  async getCredentialStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionCredentialStorage | null> {
    return this.repository.findCredentialStorage(tenant, connectionId, options);
  }

  async decryptStoredAccessToken(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<string | null> {
    const storage = await this.repository.findCredentialStorage(tenant, connectionId, options);
    return storage ? this.encryptionService.decryptAccessToken(storage.encryptedAccessToken) : null;
  }

  async storeRegistrationPin(tenant: TenantContext, connectionId: string, registrationPin: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    const encrypted = this.encryptionService.encryptRegistrationPin(registrationPin);
    return this.repository.persistRegistrationPinCredential(tenant, connectionId, {
      encryptedRegistrationPin: encrypted.encryptedRegistrationPin,
      registrationPinKeyVersion: encrypted.registrationPinKeyVersion,
      registrationPinFingerprint: encrypted.registrationPinFingerprint,
    }, options);
  }

  async decryptStoredRegistrationPin(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<string | null> {
    const storage = await this.repository.findRegistrationPinStorage(tenant, connectionId, options);
    return storage ? this.encryptionService.decryptRegistrationPin(storage.encryptedRegistrationPin) : null;
  }
}
