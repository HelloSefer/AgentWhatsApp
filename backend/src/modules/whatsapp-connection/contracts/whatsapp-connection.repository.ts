import type { DatabaseQueryExecutor, TenantContext } from "../../../infrastructure/database";
import type { ActiveWhatsAppConnectionResolution, WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";

export type WhatsAppConnectionRepositoryOptions = Readonly<{
  executor?: DatabaseQueryExecutor;
}>;

export type CreateWhatsAppConnectionCandidateInput = Readonly<{
  connectionId?: string;
}>;

export type VerifiedWhatsAppConnectionMetadataInput = Readonly<{
  metaBusinessId?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}>;

export interface WhatsAppConnectionRepository {
  createCandidate(tenant: TenantContext, input?: CreateWhatsAppConnectionCandidateInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection>;
  findByConnectionId(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  findAllForSeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<readonly WhatsAppConnection[]>;
  findCurrentForSeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<readonly WhatsAppConnection[]>;
  findActiveBySeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  resolveActiveByPhoneNumberId(phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ActiveWhatsAppConnectionResolution | null>;
  updateLifecycleStatus(tenant: TenantContext, connectionId: string, status: WhatsAppConnectionStatus, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
  persistVerifiedMetadata(tenant: TenantContext, connectionId: string, metadata: VerifiedWhatsAppConnectionMetadataInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null>;
}
