import { MAX_CART_TARGET_ITEM_COUNT } from "../../cart-state.service";
import {
  MAX_CART_QUANTITY_INPUT_LENGTH,
  type CartQuantityInputFailureCode,
  type CartQuantityInputResult,
  type CartQuantityInputSource,
} from "./cart-quantity-input.types";

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

// Mirrors the already-supported deterministic vocabulary, but only accepts it
// as an exact value or in a narrow quantity request phrase.
const SUPPORTED_QUANTITY_WORDS: Readonly<Record<string, number>> = {
  "واحدة": 1,
  "واحده": 1,
  "واحداة": 1,
  "وحدة": 1,
  "واحد": 1,
  wa7da: 1,
  wahda: 1,
  "جوج": 2,
  "زوج": 2,
  jouj: 2,
  jooj: 2,
};

const PHONE_TOKEN = /(?:^|\s)(?:\+212|00212|0)[67]\d{8}(?=$|\s)/u;
const INTERNATIONAL_PHONE_TOKEN = /(?:^|\s)\+\d{8,15}(?=$|\s)/u;
const PHONE_WITH_SEPARATORS = /(?:^|\s)(?:\+212|00212|0)[67](?:[\s().-]*\d){8}(?=$|\s)/u;
const PRICE_LIKE = /\d+(?:[.,]\d+)?\s*(?:درهم|dh(?:s)?|mad|€|\$)/iu;
const DATE_LIKE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/u;
const ORDER_ID_LIKE = /(?:\b(?:order|commande|cmd|ref)\b|طلب)\s*[-:#]?\s*[a-z]*\d{3,}/iu;
const BARE_ORDER_ID_LIKE = /\b[a-z]{2,}[-_#]\d{3,}\b/iu;
const SIZE_LIKE = /(?:مقاس|size|pointure|taille)\s*[:=-]?\s*\d+/iu;
const DECIMAL_LIKE = /\d+[.,]\d+/u;
const SCIENTIFIC_LIKE = /\d+e[+-]?\d+/iu;
const SIGNED_NUMBER = /^[+-]\d+$/u;
const DIRECT_NUMBER = /^(\d+)$/u;
const NARROW_ARABIC_NUMBER_PHRASE = /^بغيت\s+(\d+)(?:\s*(?:قطع|قطعة|ديال\s+القطع))?$/u;
const NARROW_ARABIC_SUFFIX_PHRASE = /^(\d+)\s*(?:قطع|قطعة|ديال\s+القطع)$/u;
const NARROW_ARABIZI_NUMBER_PHRASE = /^bghit\s+(\d+)(?:\s*(?:pieces?|pcs?))?$/iu;
const NARROW_LATIN_SUFFIX_PHRASE = /^(\d+)\s*(?:pieces?|pcs?)$/iu;

function normalizeDigits(value: string): { text: string; hadArabicIndicDigits: boolean } {
  let hadArabicIndicDigits = false;
  const text = Array.from(value).map((character) => {
    const mapped = ARABIC_INDIC_DIGITS[character];
    if (mapped !== undefined) {
      hadArabicIndicDigits = true;
      return mapped;
    }

    return character;
  }).join("");

  return { text, hadArabicIndicDigits };
}

function normalizeText(value: string): { text: string; hadArabicIndicDigits: boolean } {
  const converted = normalizeDigits(value);
  return {
    text: converted.text.replace(/\s+/gu, " ").trim(),
    hadArabicIndicDigits: converted.hadArabicIndicDigits,
  };
}

function failure(
  normalizedText: string,
  failureCode: CartQuantityInputFailureCode,
): CartQuantityInputResult {
  return { success: false, normalizedText, failureCode };
}

function success(
  normalizedText: string,
  quantity: number,
  source: CartQuantityInputSource,
): CartQuantityInputResult {
  return { success: true, normalizedText, quantity, source };
}

function normalizeWordKey(value: string): string {
  return value.toLocaleLowerCase().trim();
}

function findSupportedQuantityWord(value: string): number | undefined {
  return SUPPORTED_QUANTITY_WORDS[normalizeWordKey(value)];
}

function findNarrowQuantityPhrase(value: string): string | undefined {
  return (
    value.match(NARROW_ARABIC_NUMBER_PHRASE)?.[1] ||
    value.match(NARROW_ARABIC_SUFFIX_PHRASE)?.[1] ||
    value.match(NARROW_ARABIZI_NUMBER_PHRASE)?.[1] ||
    value.match(NARROW_LATIN_SUFFIX_PHRASE)?.[1]
  );
}

function isPhoneLike(value: string): boolean {
  const separated = value.replace(/[().-]/gu, " ").replace(/\s+/gu, " ").trim();
  return (
    PHONE_TOKEN.test(separated) ||
    INTERNATIONAL_PHONE_TOKEN.test(separated) ||
    PHONE_WITH_SEPARATORS.test(value)
  );
}

function validateQuantity(
  normalizedText: string,
  rawQuantity: string,
  source: CartQuantityInputSource,
): CartQuantityInputResult {
  if (!/^[1-9]\d*$/u.test(rawQuantity)) {
    return failure(normalizedText, "INVALID_QUANTITY");
  }

  const quantity = Number(rawQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return failure(normalizedText, "INVALID_QUANTITY");
  }

  if (quantity > MAX_CART_TARGET_ITEM_COUNT) {
    return failure(normalizedText, "QUANTITY_TOO_LARGE");
  }

  return success(normalizedText, quantity, source);
}

/**
 * Pure parser for a caller that is already awaiting custom quantity input.
 * It intentionally does not perform global message detection or cart mutation.
 */
export function normalizeCartCustomQuantityInput(input: unknown): CartQuantityInputResult {
  if (typeof input !== "string") {
    return failure("", "UNSUPPORTED_FORMAT");
  }

  const normalized = normalizeText(input);
  if (!normalized.text) {
    return failure(normalized.text, "EMPTY_INPUT");
  }

  if (Array.from(normalized.text).length > MAX_CART_QUANTITY_INPUT_LENGTH) {
    return failure(normalized.text, "INPUT_TOO_LONG");
  }

  if (isPhoneLike(normalized.text)) {
    return failure(normalized.text, "PHONE_LIKE_INPUT");
  }

  if (PRICE_LIKE.test(normalized.text)) {
    return failure(normalized.text, "PRICE_LIKE_INPUT");
  }

  if (DATE_LIKE.test(normalized.text) || ORDER_ID_LIKE.test(normalized.text) || BARE_ORDER_ID_LIKE.test(normalized.text)) {
    return failure(normalized.text, "UNSUPPORTED_FORMAT");
  }

  if (SIZE_LIKE.test(normalized.text)) {
    return failure(normalized.text, "UNSUPPORTED_FORMAT");
  }

  if (DECIMAL_LIKE.test(normalized.text) || SCIENTIFIC_LIKE.test(normalized.text) || SIGNED_NUMBER.test(normalized.text)) {
    return failure(normalized.text, "INVALID_QUANTITY");
  }

  const numbers = normalized.text.match(/\d+/gu) || [];
  if (numbers.length > 1) {
    return failure(normalized.text, "AMBIGUOUS_QUANTITY");
  }

  const direct = normalized.text.match(DIRECT_NUMBER)?.[1];
  if (direct) {
    return validateQuantity(
      normalized.text,
      direct,
      normalized.hadArabicIndicDigits ? "ARABIC_INDIC_DIGITS" : "WESTERN_DIGITS",
    );
  }

  const phraseQuantity = findNarrowQuantityPhrase(normalized.text);
  if (phraseQuantity) {
    return validateQuantity(normalized.text, phraseQuantity, "NARROW_QUANTITY_PHRASE");
  }

  if (!numbers.length) {
    const wordQuantity = findSupportedQuantityWord(normalized.text);
    if (wordQuantity !== undefined) {
      return success(normalized.text, wordQuantity, "SUPPORTED_QUANTITY_WORD");
    }

    const wordMatch = normalized.text.match(/^(?:(?:بغيت|bghit)\s+)?([^\s]+)$/iu)?.[1];
    const phraseWordQuantity = wordMatch ? findSupportedQuantityWord(wordMatch) : undefined;
    if (phraseWordQuantity !== undefined && /^(?:(?:بغيت|bghit)\s+)?[^\s]+$/iu.test(normalized.text)) {
      return success(normalized.text, phraseWordQuantity, "SUPPORTED_QUANTITY_WORD");
    }

    return failure(normalized.text, "NO_QUANTITY_FOUND");
  }

  return failure(normalized.text, "NO_QUANTITY_FOUND");
}
