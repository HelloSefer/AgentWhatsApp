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

export type PaymentMethod = "COD";
export type DeliveryAvailability = "all_cities" | "selected_cities" | "excluded_cities" | "not_available" | "not_mentioned";
export type DeliveryPricingMode = "ALL_FREE" | "FLAT_RATE" | "CITY_RULES";
export type DeliveryRuleType = "FREE" | "PAID" | "UNAVAILABLE";
export type RuntimeMode = "disabled" | "dry_run" | "guarded";
export type SupportedCustomerFieldKey = "fullName" | "phone" | "city" | "address" | "quantity";

export type SellerSettingsFieldError = Readonly<{
  field: string;
  code: string;
}>;

export type SellerSettingsLogo = Readonly<{
  objectKey: string;
  mimeType: string;
}>;

export type SellerSettingsDto = Readonly<{
  store: Readonly<{
    businessName: string;
    locale: "ar-MA";
    contact: Readonly<{
      intendedWhatsappPhoneE164?: string;
    }>;
    logo?: SellerSettingsLogo;
  }>;
  commerce?: Readonly<{
    payment: Readonly<{ method: PaymentMethod; enabled: boolean }>;
    delivery: Readonly<{
      enabled: boolean;
      availability: DeliveryAvailability;
      pricing: Readonly<{
        mode: DeliveryPricingMode;
        currency: "MAD";
        flatRateMinor?: number;
        rules?: readonly Readonly<{
          id: string;
          type: DeliveryRuleType;
          cityKeys: readonly string[];
          aliases?: readonly string[];
          amountMinor?: number;
          priority?: number;
        }>[];
        defaultRule?: Readonly<{ id?: string; type: DeliveryRuleType; amountMinor?: number }>;
      }>;
    }>;
    requiredCustomerFields: readonly Readonly<{
      key: SupportedCustomerFieldKey;
      label: string;
      prompt?: string;
      required: boolean;
      enabled: boolean;
      askOrder?: number;
      captureMode?: string;
      requirement?: string;
    }>[];
    orderBehavior: Readonly<{
      multiItemOrderFlow: Readonly<{
        enabled: boolean;
        runtimeMode: RuntimeMode;
      }>;
    }>;
    receipt: Readonly<{
      enabled: boolean;
      sendAfterConfirmation: boolean;
      showLogo?: boolean;
      footerText?: string;
      paymentMethodLabel?: string;
    }>;
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
    contact?: Readonly<{
      intendedWhatsappPhoneE164?: string | null;
    }>;
    logo?: SellerSettingsLogo | null;
  }>;
  commerce?: NonNullable<SellerSettingsDto["commerce"]>;
}>;

export type SellerSettingsSafeErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "domain_validation"
  | "service_unavailable";

export type SellerSettingsSafeError = Readonly<{
  code: SellerSettingsSafeErrorCode;
  message: string;
  status: number;
  fieldErrors?: readonly SellerSettingsFieldError[];
}>;
