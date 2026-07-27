import type { TenantContext } from "../../../infrastructure/database";
import type { SellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import type { SellerLogoStorage } from "../contracts/seller-logo-storage";
import {
  SellerLogoPersistenceError,
  SellerLogoProfileNotFoundError,
  SellerLogoStorageError,
  SellerLogoValidationError,
} from "../domain/seller-logo.errors";
import type { SellerLogoMetadata } from "../domain/seller-logo.types";
import {
  createSellerLogoObjectKey,
  validateSellerLogoUpload,
} from "../domain/seller-logo.validation";

export type SellerLogoServiceDependencies = Readonly<{
  storage: SellerLogoStorage;
  profileRepository: SellerWorkspaceProfileRepository;
}>;

export class SellerLogoService {
  constructor(private readonly dependencies: SellerLogoServiceDependencies) {}

  async uploadOrReplaceLogo(tenant: TenantContext, bytes: unknown, mimeType: unknown): Promise<SellerLogoMetadata> {
    const upload = validateSellerLogoUpload(bytes, mimeType);
    const existingProfile = await this.dependencies.profileRepository.findByTenantContext(tenant);
    if (!existingProfile) throw new SellerLogoProfileNotFoundError();

    const previousObjectKey = existingProfile.logoObjectKey;
    const objectKey = createSellerLogoObjectKey(tenant.sellerId, upload.mimeType);
    const stored = await this.dependencies.storage.store({
      objectKey,
      bytes: upload.bytes,
      mimeType: upload.mimeType,
    });

    try {
      const updatedProfile = await this.dependencies.profileRepository.updateLogoMetadata(tenant, stored);
      if (!updatedProfile) throw new SellerLogoProfileNotFoundError();
    } catch (error) {
      await this.dependencies.storage.delete(stored.objectKey);
      if (error instanceof SellerLogoProfileNotFoundError) throw error;
      throw new SellerLogoPersistenceError(error);
    }

    if (previousObjectKey && previousObjectKey !== stored.objectKey) {
      await this.dependencies.storage.delete(previousObjectKey);
    }

    return stored;
  }

  async removeLogo(tenant: TenantContext): Promise<void> {
    const existingProfile = await this.dependencies.profileRepository.findByTenantContext(tenant);
    if (!existingProfile) throw new SellerLogoProfileNotFoundError();
    const previousObjectKey = existingProfile.logoObjectKey;
    const updatedProfile = await this.dependencies.profileRepository.clearLogoMetadata(tenant);
    if (!updatedProfile) throw new SellerLogoProfileNotFoundError();
    if (previousObjectKey) await this.dependencies.storage.delete(previousObjectKey);
  }
}

export {
  SellerLogoPersistenceError,
  SellerLogoProfileNotFoundError,
  SellerLogoStorageError,
  SellerLogoValidationError,
};
