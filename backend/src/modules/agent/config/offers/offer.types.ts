export const MAX_PRODUCT_OFFER_REQUIRED_ITEM_COUNT = 100;
export const MAX_PRODUCT_OFFER_ID_LENGTH = 128;
export const MAX_PRODUCT_OFFER_LABEL_LENGTH = 160;
export const MAX_PRODUCT_OFFER_PRIORITY = 100_000;

/**
 * Authoritative product-level commercial configuration. This phase validates
 * and looks up offers only; it does not select, price, or apply them to carts.
 */
export type ProductOfferConfig = {
  id: string;
  productId: string;
  label: string;
  requiredItemCount: number;
  totalPrice: number;
  currency: string;
  active: boolean;
  allowMixedOptions: boolean;
  priority?: number;
  startsAt?: string;
  endsAt?: string;
};

export type OfferConfigIssueCode =
  | "INVALID_PRODUCT_ID"
  | "INVALID_OFFER"
  | "EMPTY_ID"
  | "INVALID_ID"
  | "DUPLICATE_ID"
  | "PRODUCT_ID_MISMATCH"
  | "EMPTY_LABEL"
  | "INVALID_LABEL"
  | "INVALID_REQUIRED_ITEM_COUNT"
  | "INVALID_TOTAL_PRICE"
  | "INVALID_CURRENCY"
  | "INVALID_ACTIVE"
  | "INVALID_ALLOW_MIXED_OPTIONS"
  | "INVALID_PRIORITY"
  | "INVALID_STARTS_AT"
  | "INVALID_ENDS_AT"
  | "INVALID_AVAILABILITY_WINDOW";

export type OfferConfigIssue = {
  path: string;
  code: OfferConfigIssueCode;
  message: string;
};

export type ProductOfferConfigValidationResult = {
  valid: boolean;
  normalizedOffers: ProductOfferConfig[];
  errors: OfferConfigIssue[];
  warnings: OfferConfigIssue[];
};

export type ProductOfferConfigurationState =
  | "PRODUCT_NOT_FOUND"
  | "NO_OFFERS_CONFIGURED"
  | "INVALID_CONFIGURATION"
  | "OFFERS_CONFIGURED"
  | "OFFERS_CONFIGURED_BUT_INACTIVE";

