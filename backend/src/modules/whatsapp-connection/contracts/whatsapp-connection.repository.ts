import type { DatabaseQueryExecutor, TenantContext } from "../../../infrastructure/database";
import type {
  PersistWhatsAppConnectionCredentialInput,
  PersistManualWhatsAppConnectionCredentialInput,
  ManualWhatsAppConnectionCredentialStorage,
  PersistWhatsAppConnectionRegistrationPinInput,
  WhatsAppConnectionCredentialStorage,
  WhatsAppConnectionRegistrationPinStorage,
} from "../domain/whatsapp-connection-credentials.types";
import type { ActiveWhatsAppConnectionResolution, WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";

export type WhatsAppConnectionRepositoryOptions = Readonly<{
  executor?: DatabaseQueryExecutor;
}>;

export type CreateWhatsAppConnectionCandidateInput = Readonly<{
  connectionId?: string;
}>;

export type CreateManualWhatsAppConnectionDraftInput = Readonly<{
  metaAppId: string;
  publicWebhookId: string;
}>;

export type ReplaceManualWhatsAppConnectionCredentialsInput =
  PersistManualWhatsAppConnectionCredentialInput & Readonly<{
    metaAppId: string;
  }>;

export type VerifiedWhatsAppConnectionMetadataInput = Readonly<{
  metaBusinessId?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}>;

export type WhatsAppConnectionFinalizationProgressInput = Readonly<{
  phoneRegistrationCompletedAt?: Date | null;
  wabaSubscriptionCompletedAt?: Date | null;
  finalizationLastErrorCode?: string | null;
  clearFinalizationLastError?: boolean;
}>;

export interface WhatsAppConnectionRepository {
  createCandidate(tenant: TenantContext, input?: CreateWhatsAppConnectionCandidateInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection>;
  findByConnectionId(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  setBoundProductId?(tenant: TenantContext, connectionId: string, productId: string | null, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  findAllForSeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<readonly WhatsAppConnection[]>;
  findCurrentForSeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<readonly WhatsAppConnection[]>;
  findActiveBySeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  findByPhoneNumberIdForSeller(tenant: TenantContext, phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  resolveByPhoneNumberId(phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ActiveWhatsAppConnectionResolution | null>;
  resolveActiveByPhoneNumberId(phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ActiveWhatsAppConnectionResolution | null>;
  updateLifecycleStatus(tenant: TenantContext, connectionId: string, status: WhatsAppConnectionStatus, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  markReplacementPending(tenant: TenantContext, connectionId: string, replacedConnectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  replaceActiveConnection(tenant: TenantContext, activeConnectionId: string, replacementConnectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  disconnectActiveConnection(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  persistVerifiedMetadata(tenant: TenantContext, connectionId: string, metadata: VerifiedWhatsAppConnectionMetadataInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  persistAccessTokenCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionCredentialInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionCredentialStorage | null>;
  findCredentialStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionCredentialStorage | null>;
  persistRegistrationPinCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionRegistrationPinInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionRegistrationPinStorage | null>;
  findRegistrationPinStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionRegistrationPinStorage | null>;
  persistFinalizationProgress(tenant: TenantContext, connectionId: string, input: WhatsAppConnectionFinalizationProgressInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  activateConnection(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
}

export interface ManualWhatsAppConnectionRepository extends WhatsAppConnectionRepository {
  createManualDraft(tenant: TenantContext, input: CreateManualWhatsAppConnectionDraftInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection>;
  findReusableManualDraft(tenant: TenantContext, metaAppId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  findByPublicWebhookId(publicWebhookId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  persistManualCredentials(tenant: TenantContext, connectionId: string, credential: PersistManualWhatsAppConnectionCredentialInput, options?: WhatsAppConnectionRepositoryOptions): Promise<ManualWhatsAppConnectionCredentialStorage | null>;
  replaceManualCredentialsAndResetState(tenant: TenantContext, connectionId: string, credential: ReplaceManualWhatsAppConnectionCredentialsInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  findManualCredentialStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ManualWhatsAppConnectionCredentialStorage | null>;
}
