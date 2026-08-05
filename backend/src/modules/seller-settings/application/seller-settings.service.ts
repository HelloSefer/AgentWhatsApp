import { withTransaction } from "../../../infrastructure/database/transactions/with-transaction.service";
import type { TenantContext } from "../../../infrastructure/database";
import type { SellerWorkspaceProfile, SellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import { SellerCommerceConfigRepository, type PersistedSellerCommerceConfig } from "../../seller-commerce-config";
import { SellerCommerceConfigValidationError } from "../../seller-commerce-config/seller-commerce-config.types";
import type { SellerSettingsChangedSection, SellerSettingsDto, SellerSettingsUpdateInput } from "./seller-settings.types";
import { SellerSettingsProfileRequiredError } from "./seller-settings.types";
import { recordSellerSettingsAudit } from "./seller-settings-operational-events";

function logo(profile: SellerWorkspaceProfile): SellerSettingsDto["store"]["logo"] | undefined {
  if (!profile.logoObjectKey || !profile.logoMimeType) return undefined;
  return {
    objectKey: profile.logoObjectKey,
    mimeType: profile.logoMimeType,
  };
}

function updatedAt(profile: SellerWorkspaceProfile | null, commerce: PersistedSellerCommerceConfig | null): string | undefined {
  const timestamps = [
    profile?.updatedAt,
    commerce?.updatedAt,
  ].filter((value): value is Date => value instanceof Date);
  if (!timestamps.length) return undefined;
  return new Date(Math.max(...timestamps.map((value) => value.getTime()))).toISOString();
}

function dto(
  profile: SellerWorkspaceProfile | null,
  commerce: PersistedSellerCommerceConfig | null,
  commerceInvalid = false,
): SellerSettingsDto {
  const issues: SellerSettingsDto["readiness"]["issues"] = [
    ...(!profile ? [{ code: "WORKSPACE_PROFILE_REQUIRED" as const, field: "store" }] : []),
    ...(commerceInvalid ? [{ code: "SELLER_COMMERCE_CONFIG_INVALID" as const, field: "commerce" }] : []),
    ...(!commerce && !commerceInvalid ? [{ code: "SELLER_COMMERCE_CONFIG_REQUIRED" as const, field: "commerce" }] : []),
  ];
  const status = issues.length === 0 ? "READY" : issues[0]?.code ?? "DEGRADED";
  return {
    store: {
      businessName: profile?.displayName ?? "",
      locale: "ar-MA",
      contact: {
        ...(profile?.intendedWhatsappPhoneE164 ? { intendedWhatsappPhoneE164: profile.intendedWhatsappPhoneE164 } : {}),
      },
      ...(profile ? { logo: logo(profile) } : {}),
    },
    ...(commerce ? {
      commerce: {
        payment: commerce.config.payment,
        delivery: commerce.config.delivery,
        requiredCustomerFields: commerce.config.requiredCustomerFields,
        orderBehavior: {
          multiItemOrderFlow: {
            enabled: commerce.config.orderBehavior.multiItemOrderFlow.enabled,
            runtimeMode: commerce.config.orderBehavior.multiItemOrderFlow.runtimeMode,
          },
        },
        receipt: commerce.config.receipt,
      },
    } : {}),
    readiness: {
      status,
      issues,
    },
    ...(updatedAt(profile, commerce) ? { updatedAt: updatedAt(profile, commerce) } : {}),
  };
}

export class SellerSettingsService {
  constructor(
    private readonly profileRepository: SellerWorkspaceProfileRepository,
    private readonly commerceRepositoryFactory: (executor?: ConstructorParameters<typeof SellerCommerceConfigRepository>[0]) => SellerCommerceConfigRepository = (executor) => new SellerCommerceConfigRepository(executor),
  ) {}

  async read(tenant: TenantContext): Promise<SellerSettingsDto> {
    const profile = await this.profileRepository.findByTenantContext(tenant);
    try {
      const commerce = await this.commerceRepositoryFactory().find(tenant);
      return dto(profile, commerce);
    } catch (error) {
      if (error instanceof SellerCommerceConfigValidationError) return dto(profile, null, true);
      throw error;
    }
  }

  async update(
    tenant: TenantContext,
    input: SellerSettingsUpdateInput,
    audit: Readonly<{ role: "OWNER" | "ADMIN" }>,
  ): Promise<Readonly<{ settings: SellerSettingsDto; changedSections: readonly SellerSettingsChangedSection[] }>> {
    const changedSections: SellerSettingsChangedSection[] = [];
    const settings = await withTransaction(async (transaction) => {
      let profile = await this.profileRepository.findByTenantContext(tenant, { executor: transaction });
      if (!profile) throw new SellerSettingsProfileRequiredError();
      const commerceRepository = this.commerceRepositoryFactory(transaction);
      let commerce: PersistedSellerCommerceConfig | null;
      try {
        commerce = await commerceRepository.find(tenant);
      } catch (error) {
        if (error instanceof SellerCommerceConfigValidationError) commerce = null;
        else throw error;
      }

      if (input.store) {
        let storeChanged = false;
        if (input.store.businessName !== undefined && input.store.businessName !== profile.displayName) {
          const updated = await this.profileRepository.updateDisplayName(tenant, input.store.businessName, { executor: transaction });
          if (!updated) throw new SellerSettingsProfileRequiredError();
          profile = updated;
          storeChanged = true;
        }
        if (input.store.contact && input.store.contact.intendedWhatsappPhoneE164 !== profile.intendedWhatsappPhoneE164) {
          const updated = await this.profileRepository.updateIntendedPhone(tenant, input.store.contact.intendedWhatsappPhoneE164, { executor: transaction });
          if (!updated) throw new SellerSettingsProfileRequiredError();
          profile = updated;
          storeChanged = true;
        }
        if ("logo" in input.store) {
          if (input.store.logo === null) {
            if (profile.logoObjectKey || profile.logoMimeType) {
              const updated = await this.profileRepository.clearLogoMetadata(tenant, { executor: transaction });
              if (!updated) throw new SellerSettingsProfileRequiredError();
              profile = updated;
              storeChanged = true;
            }
          } else if (
            input.store.logo &&
            (input.store.logo.objectKey !== profile.logoObjectKey || input.store.logo.mimeType !== profile.logoMimeType)
          ) {
            const updated = await this.profileRepository.updateLogoMetadata(tenant, input.store.logo, { executor: transaction });
            if (!updated) throw new SellerSettingsProfileRequiredError();
            profile = updated;
            storeChanged = true;
          }
        }
        if (storeChanged) changedSections.push("store");
      }

      if (input.commerce) {
        const nextCommerce = await commerceRepository.save(tenant, {
          configVersion: 1,
          ...input.commerce,
          orderBehavior: {
            multiItemOrderFlow: {
              ...input.commerce.orderBehavior.multiItemOrderFlow,
              allowedSellerIds: commerce?.config.orderBehavior.multiItemOrderFlow.allowedSellerIds ?? [tenant.sellerId],
            },
          },
        });
        commerce = nextCommerce;
        changedSections.push("commerce");
      }

      return dto(profile, commerce);
    });

    recordSellerSettingsAudit("seller_settings.updated", {
      role: audit.role,
      changedSections,
      result: "success",
    });
    return { settings, changedSections };
  }
}
