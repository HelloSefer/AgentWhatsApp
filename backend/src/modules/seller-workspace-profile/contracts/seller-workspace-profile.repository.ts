import type { TenantContext } from "../../../infrastructure/database";
import type { SellerWorkspaceLogoMetadata, SellerWorkspaceProfile } from "../domain/seller-workspace-profile.types";

export type CreateSellerWorkspaceProfileInput = Readonly<{
  sellerId: string;
  displayName: string;
  intendedWhatsappPhoneE164?: string | null;
  logo?: SellerWorkspaceLogoMetadata | null;
  onboardingCompletedAt?: Date | null;
}>;

export interface SellerWorkspaceProfileRepository {
  createProfile(input: CreateSellerWorkspaceProfileInput): Promise<SellerWorkspaceProfile>;
  findByTenantContext(tenant: TenantContext): Promise<SellerWorkspaceProfile | null>;
  updateDisplayName(tenant: TenantContext, displayName: string): Promise<SellerWorkspaceProfile | null>;
  updateIntendedPhone(tenant: TenantContext, intendedWhatsappPhoneE164?: string | null): Promise<SellerWorkspaceProfile | null>;
  updateLogoMetadata(tenant: TenantContext, logo: SellerWorkspaceLogoMetadata): Promise<SellerWorkspaceProfile | null>;
  clearLogoMetadata(tenant: TenantContext): Promise<SellerWorkspaceProfile | null>;
  onboardingProfileExists(tenant: TenantContext): Promise<boolean>;
}
