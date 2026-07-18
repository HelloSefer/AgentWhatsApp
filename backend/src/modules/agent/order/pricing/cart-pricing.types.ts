import type { CartDraft } from "../cart-state.types";
import type { ProductOfferConfig } from "../../config/offers/offer.types";
import type { ProductContext } from "../../config/product-context.types";

export const cartPricingFailureCodes = [
  "EMPTY_CART",
  "INVALID_CART",
  "INCOMPLETE_CURRENT_ITEM",
  "PRODUCT_MISMATCH",
  "MISSING_TRUSTED_PRICE",
  "CURRENCY_MISMATCH",
  "OFFER_NOT_FOUND",
  "OFFER_INACTIVE",
  "OFFER_NOT_STARTED",
  "OFFER_EXPIRED",
  "ITEM_COUNT_MISMATCH",
  "MIXED_OPTIONS_NOT_ALLOWED",
  "INVALID_OFFER_CONFIG",
  "UNSAFE_MONEY_VALUE",
  "OFFER_TOTAL_EXCEEDS_STANDARD_SUBTOTAL",
  "INVALID_CLOCK",
] as const;

export type CartPricingFailureCode = (typeof cartPricingFailureCodes)[number];

export type CartPricingFailure = {
  code: CartPricingFailureCode;
  message: string;
  offerId?: string;
  paths?: string[];
};

export type CartPricingLine = Readonly<{
  cartItemId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  standardLineTotal: number;
}>;

/** Immutable trusted pricing data for a future confirmed-order snapshot. */
export type CartPricingQuote = Readonly<{
  currency: string;
  totalUnits: number;
  lines: readonly CartPricingLine[];
  standardSubtotal: number;
  appliedOfferId?: string;
  appliedOfferLabel?: string;
  offerTotal?: number;
  discountAmount: number;
  merchandiseTotal: number;
  generatedAt: string;
}>;

export type StandardCartPricingResult = {
  ok: boolean;
  quote?: CartPricingQuote;
  failures: CartPricingFailure[];
};

export type OfferEligibilityResult = {
  eligible: boolean;
  offerId: string;
  offer?: ProductOfferConfig;
  totalUnits: number;
  failures: CartPricingFailure[];
};

export type OfferPricingEvaluation = {
  offer: ProductOfferConfig;
  eligibility: OfferEligibilityResult;
  quote?: CartPricingQuote;
};

export type SelectedOfferPricingResult = {
  standardPricing: StandardCartPricingResult;
  offerEligibility: OfferEligibilityResult;
  quote?: CartPricingQuote;
};

export type EligibleOffersPricingResult = {
  standardPricing: StandardCartPricingResult;
  evaluations: OfferPricingEvaluation[];
  eligibleOffers: OfferPricingEvaluation[];
  recommendedOffer?: OfferPricingEvaluation;
};

export type CartPricingInput = {
  sellerId: string;
  productContext: ProductContext;
  cart: CartDraft;
  fields?: import("../../config/required-fields.types").RequiredOrderField[];
  now?: Date;
};
