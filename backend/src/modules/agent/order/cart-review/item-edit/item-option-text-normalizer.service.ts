import { MAX_CART_ITEM_EDIT_TEXT_LENGTH } from "./cart-item-edit.types";

const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;

export type CartItemEditTextNormalizationResult =
  | { valid: true; value: string }
  | { valid: false; failureCode: "INVALID_ITEM_OPTION_TEXT" };

/** Accepts open-text options only after the edit preview explicitly awaits them. */
export function normalizeCartItemEditText(value: unknown): CartItemEditTextNormalizationResult {
  if (typeof value !== "string" || UNSAFE_CONTROL_CHARACTERS.test(value)) {
    return { valid: false, failureCode: "INVALID_ITEM_OPTION_TEXT" };
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized || Array.from(normalized).length > MAX_CART_ITEM_EDIT_TEXT_LENGTH) {
    return { valid: false, failureCode: "INVALID_ITEM_OPTION_TEXT" };
  }

  return { valid: true, value: normalized };
}
