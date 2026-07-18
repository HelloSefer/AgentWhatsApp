export const MAX_CART_QUANTITY_INPUT_LENGTH = 120;

export type CartQuantityInputSource =
  | "WESTERN_DIGITS"
  | "ARABIC_INDIC_DIGITS"
  | "SUPPORTED_QUANTITY_WORD"
  | "NARROW_QUANTITY_PHRASE";

export type CartQuantityInputFailureCode =
  | "EMPTY_INPUT"
  | "INPUT_TOO_LONG"
  | "NO_QUANTITY_FOUND"
  | "AMBIGUOUS_QUANTITY"
  | "INVALID_QUANTITY"
  | "QUANTITY_TOO_LARGE"
  | "PHONE_LIKE_INPUT"
  | "PRICE_LIKE_INPUT"
  | "UNSUPPORTED_FORMAT";

export type CartQuantityInputResult = {
  success: boolean;
  normalizedText: string;
  quantity?: number;
  source?: CartQuantityInputSource;
  failureCode?: CartQuantityInputFailureCode;
};
