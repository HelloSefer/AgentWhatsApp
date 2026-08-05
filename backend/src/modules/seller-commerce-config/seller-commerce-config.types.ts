import type { CustomerFieldConfig, DeliveryAvailability, DeliveryPriceRuleType, MultiItemOrderFlowConfig } from "../agent/config/seller-config.types";

export type SellerCommerceConfigV1 = Readonly<{
  configVersion: 1;
  payment: Readonly<{ method: "COD"; enabled: boolean }>;
  delivery: Readonly<{
    enabled: boolean;
    availability: DeliveryAvailability;
    pricing: Readonly<{
      mode: "ALL_FREE" | "FLAT_RATE" | "CITY_RULES";
      currency: "MAD";
      flatRateMinor?: number;
      rules?: readonly Readonly<{ id: string; type: DeliveryPriceRuleType; cityKeys: readonly string[]; aliases?: readonly string[]; amountMinor?: number; priority?: number }>[];
      defaultRule?: Readonly<{ id?: string; type: DeliveryPriceRuleType; amountMinor?: number }>;
    }>;
  }>;
  requiredCustomerFields: readonly CustomerFieldConfig[];
  orderBehavior: Readonly<{ multiItemOrderFlow: MultiItemOrderFlowConfig }>;
  receipt: Readonly<{ enabled: boolean; sendAfterConfirmation: boolean; showLogo?: boolean; footerText?: string; paymentMethodLabel?: string }>;
}>;

export class SellerCommerceConfigValidationError extends Error {
  constructor(message = "SELLER_COMMERCE_CONFIG_INVALID") { super(message); this.name = "SellerCommerceConfigValidationError"; }
}
