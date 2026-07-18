import type { ProductOfferLookupResult } from "../../config/offers/offer-config.service";
import type { CartIntegrityResult } from "../cart-state.types";
import type {
  CartPricingFailure,
  CartPricingInput,
  CartPricingQuote,
} from "../pricing/cart-pricing.types";

export type CartCommercialState =
  | "NO_OFFERS_CONFIGURED"
  | "STANDARD_ONLY"
  | "OFFER_AVAILABLE"
  | "SELECTED_OFFER_ELIGIBLE"
  | "SELECTED_OFFER_INELIGIBLE"
  | "COMMERCIAL_EVALUATION_BLOCKED";

export type CommercialComparisonState =
  | "NO_MEANINGFUL_CHANGE"
  | "OFFER_GAINED_AFTER_CART_CHANGE"
  | "OFFER_LOST_AFTER_CART_CHANGE"
  | "SELECTED_OFFER_BECAME_INELIGIBLE"
  | "COMMERCIAL_STATE_CHANGED";

export type CommercialOfferQuote = Readonly<{
  offerId: string;
  pricing: CartPricingQuote;
}>;

export type SelectedCommercialOffer = Readonly<{
  offerId: string;
  eligible: boolean;
  pricing?: CartPricingQuote;
  failureCode?: CartPricingFailure["code"];
}>;

export type CartCommercialEvaluation = Readonly<{
  evaluatedAt: string;
  state: CartCommercialState;
  cartValid: boolean;
  cartIntegrityErrors: readonly string[];
  standardPricing?: CartPricingQuote;
  selectedOffer?: SelectedCommercialOffer;
  eligibleOffers: readonly CommercialOfferQuote[];
  recommendedOffer?: CommercialOfferQuote;
  warnings: readonly string[];
  failures: readonly CartPricingFailure[];
}>;

export type CartCommercialEvaluationInput = Omit<CartPricingInput, "now"> & {
  now: Date;
  /** B1-validated seller/product-scoped offer configuration. */
  offerLookup: ProductOfferLookupResult;
};

export type CartCommercialEvaluationComparison = Readonly<{
  state: CommercialComparisonState;
  offerGained: boolean;
  offerLost: boolean;
  selectedOfferBecameIneligible: boolean;
  meaningfulChange: boolean;
  previousRecommendedOfferId?: string;
  currentRecommendedOfferId?: string;
}>;

export type CartCommercialIntegrity = Pick<CartIntegrityResult, "valid" | "invalidPaths">;
