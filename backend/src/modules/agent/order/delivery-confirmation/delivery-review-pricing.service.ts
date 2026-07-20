import type { DeliveryPricingConfig } from "../../config/seller-config.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { resolveDeliveryQuote } from "../delivery-pricing.service";
import type { CartDraft } from "../cart-state.types";
import type { DeliveryFeeSnapshot } from "./delivery-confirmation.types";

const MONEY_SCALE = 100;

export function toMinorMoney(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const scaled = value * MONEY_SCALE;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 0.0000001
    ? rounded
    : undefined;
}

export function resolveReviewDeliveryFee(input: {
  cart: CartDraft;
  requiredFields: RequiredOrderField[];
  deliveryPricing?: DeliveryPricingConfig;
}): { configured: boolean; fee?: DeliveryFeeSnapshot } {
  if (!input.deliveryPricing?.enabled) return { configured: false };

  const cityField = input.requiredFields.find((field) => {
    const key = field.key.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
    const semantic = field.semanticType?.trim().toLocaleUpperCase();
    return key === "city" || key === "location" || semantic === "LOCATION";
  });
  const cityValue = cityField ? input.cart.orderLevelFields[cityField.key] : undefined;
  const city = typeof cityValue === "string" ? cityValue.trim() : "";
  if (!city) return { configured: true };

  const quote = resolveDeliveryQuote({ city, config: input.deliveryPricing });
  if (quote.status !== "RESOLVED") return { configured: true };
  const amountMinor = toMinorMoney(quote.amount);
  if (amountMinor === undefined) return { configured: true };

  return {
    configured: true,
    fee: {
      type: quote.type,
      amountMinor,
      amount: amountMinor / MONEY_SCALE,
      currency: quote.currency,
    },
  };
}
