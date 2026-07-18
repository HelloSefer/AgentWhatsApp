import type {
  CartQuantityInputFailureCode,
  CartQuantityInputSource,
} from "../../planning/quantity/cart-quantity-input.types";

export type CurrentItemQuantityFailureCode =
  | CartQuantityInputFailureCode
  | "QUANTITY_EXCEEDS_REMAINING_TARGET";

export type CurrentItemQuantityResult = {
  success: boolean;
  normalizedText: string;
  quantity?: number;
  source?: CartQuantityInputSource;
  failureCode?: CurrentItemQuantityFailureCode;
};

export type CurrentItemQuantityNormalizationInput = {
  text: unknown;
  remainingUnits: number;
};
