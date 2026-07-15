import type { SellerConfig } from "./seller-config.types";
import { validateDeliveryPricingConfig } from "../order/delivery-pricing.service";

export type SellerConfigReadiness = {
  ready: boolean;
  reasons: string[];
  checks: {
    deliveryPricing: boolean;
  };
};

export function validateSellerConfigReadiness(
  sellerConfig: SellerConfig,
): SellerConfigReadiness {
  const deliveryPricing = validateDeliveryPricingConfig(
    sellerConfig.deliveryPolicy.pricing,
  );

  return {
    ready: deliveryPricing.ready,
    reasons: [...deliveryPricing.reasons],
    checks: {
      deliveryPricing: deliveryPricing.ready,
    },
  };
}
