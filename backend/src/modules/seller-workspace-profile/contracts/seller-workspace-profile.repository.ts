import type { DatabaseQueryExecutor, TenantContext } from "../../../infrastructure/database";
import type { SellerWorkspaceLogoMetadata, SellerWorkspaceProfile } from "../domain/seller-workspace-profile.types";

export type SellerWorkspaceProfileRepositoryOptions = Readonly<{
  executor?: DatabaseQueryExecutor;
}>;

export type CreateSellerWorkspaceProfileInput = Readonly<{
  sellerId: string;
  displayName: string;
  intendedWhatsappPhoneE164?: string | null;
  logo?: SellerWorkspaceLogoMetadata | null;
  onboardingCompletedAt?: Date | null;
}>;

export interface SellerWorkspaceProfileRepository {
  createProfile(input: CreateSellerWorkspaceProfileInput, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile>;
  findByTenantContext(tenant: TenantContext, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile | null>;
  updateDisplayName(tenant: TenantContext, displayName: string, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile | null>;
  updateIntendedPhone(tenant: TenantContext, intendedWhatsappPhoneE164?: string | null, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile | null>;
  updateLogoMetadata(tenant: TenantContext, logo: SellerWorkspaceLogoMetadata, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile | null>;
  clearLogoMetadata(tenant: TenantContext, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile | null>;
  onboardingProfileExists(tenant: TenantContext, options?: SellerWorkspaceProfileRepositoryOptions): Promise<boolean>;
}
