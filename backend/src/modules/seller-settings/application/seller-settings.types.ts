import type { SellerCommerceConfigV1 } from "../../seller-commerce-config";

export type SellerSettingsReadinessStatus =
  | "READY"
  | "SELLER_COMMERCE_CONFIG_REQUIRED"
  | "SELLER_COMMERCE_CONFIG_INVALID"
  | "WORKSPACE_PROFILE_REQUIRED"
  | "DEGRADED";

export type SellerSettingsReadinessIssueCode =
  | "WORKSPACE_PROFILE_REQUIRED"
  | "SELLER_COMMERCE_CONFIG_REQUIRED"
  | "SELLER_COMMERCE_CONFIG_INVALID";

export type SellerSettingsDto = Readonly<{
  store: Readonly<{
    businessName: string;
    locale: "ar-MA";
    contact: Readonly<{
      intendedWhatsappPhoneE164?: string;
    }>;
    logo?: Readonly<{
      objectKey: string;
      mimeType: string;
    }>;
  }>;
  commerce?: Readonly<{
    payment: SellerCommerceConfigV1["payment"];
    delivery: SellerCommerceConfigV1["delivery"];
    requiredCustomerFields: SellerCommerceConfigV1["requiredCustomerFields"];
    orderBehavior: Readonly<{
      multiItemOrderFlow: Readonly<{
        enabled: boolean;
        runtimeMode: SellerCommerceConfigV1["orderBehavior"]["multiItemOrderFlow"]["runtimeMode"];
      }>;
    }>;
    receipt: SellerCommerceConfigV1["receipt"];
  }>;
  readiness: Readonly<{
    status: SellerSettingsReadinessStatus;
    issues: readonly Readonly<{ code: SellerSettingsReadinessIssueCode; field?: string }>[];
  }>;
  updatedAt?: string;
}>;

export type SellerSettingsUpdateInput = Readonly<{
  store?: Readonly<{
    businessName?: string;
    locale?: "ar-MA";
    contact?: Readonly<{
      intendedWhatsappPhoneE164?: string | null;
    }>;
    logo?: Readonly<{
      objectKey: string;
      mimeType: string;
    }> | null;
  }>;
  commerce?: Omit<SellerCommerceConfigV1, "configVersion" | "orderBehavior"> & Readonly<{
    orderBehavior: Readonly<{
      multiItemOrderFlow: Readonly<{
        enabled: boolean;
        runtimeMode: SellerCommerceConfigV1["orderBehavior"]["multiItemOrderFlow"]["runtimeMode"];
      }>;
    }>;
  }>;
}>;

export type SellerSettingsChangedSection = "store" | "commerce";

export class SellerSettingsValidationError extends Error {
  constructor(readonly issues: readonly Readonly<{ field: string; code: string }>[]) {
    super("Seller settings input is invalid.");
    this.name = "SellerSettingsValidationError";
  }
}

export class SellerSettingsProfileRequiredError extends Error {
  constructor() {
    super("Seller workspace profile is required.");
    this.name = "SellerSettingsProfileRequiredError";
  }
}

export class SellerSettingsForbiddenRoleError extends Error {
  constructor() {
    super("Seller settings role is forbidden.");
    this.name = "SellerSettingsForbiddenRoleError";
  }
}
