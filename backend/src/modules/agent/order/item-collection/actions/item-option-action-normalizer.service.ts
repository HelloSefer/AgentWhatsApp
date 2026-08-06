import type {
  ItemOptionAction,
  ItemOptionActionNormalizationResult,
} from "./item-option-action.types";

const ACTION_PREFIX = "cart_item_option:";
const MAX_ACTION_ID_LENGTH = 200;
const MAX_ACTION_SEGMENT_LENGTH = 80;
const UNSAFE_ACTION_SEGMENT = /[:%\s\u0000-\u001F\u007F-\u009F]/u;

function result(input: ItemOptionActionNormalizationResult): ItemOptionActionNormalizationResult {
  return input.action
    ? { ...input, action: { ...input.action } }
    : { ...input };
}

function isSafeSegment(value: string): boolean {
  return (
    Boolean(value) &&
    Array.from(value).length <= MAX_ACTION_SEGMENT_LENGTH &&
    !UNSAFE_ACTION_SEGMENT.test(value)
  );
}

/**
 * Recognizes only D2B canonical item-option action IDs. It never consumes
 * generic interactive IDs or normal customer text.
 */
export function normalizeItemOptionActionId(rawId: unknown): ItemOptionActionNormalizationResult {
  if (typeof rawId !== "string" || !rawId.startsWith(ACTION_PREFIX)) {
    return result({ recognized: false, valid: false, failureCode: "NOT_ITEM_OPTION_ACTION" });
  }

  if (Array.from(rawId).length > MAX_ACTION_ID_LENGTH) {
    return result({ recognized: true, valid: false, failureCode: "ACTION_ID_TOO_LONG" });
  }

  const segments = rawId.split(":");
  if ((segments.length !== 3 && segments.length !== 5) || segments[0] !== "cart_item_option") {
    return result({ recognized: true, valid: false, failureCode: "MALFORMED_ACTION_ID" });
  }

  const [, first, second, third, fourth] = segments;
  const isScoped = segments.length === 5;
  const productId = isScoped ? first : undefined;
  const fieldKey = isScoped ? second : first;
  const canonicalValue = isScoped ? third : second;
  const targetId = isScoped ? fourth : undefined;
  if (!fieldKey) {
    return result({ recognized: true, valid: false, failureCode: "EMPTY_FIELD_KEY" });
  }
  if (!canonicalValue) {
    return result({ recognized: true, valid: false, failureCode: "EMPTY_CANONICAL_VALUE" });
  }
  if (!isSafeSegment(fieldKey)) {
    return result({ recognized: true, valid: false, failureCode: "UNSAFE_FIELD_KEY" });
  }
  if (!isSafeSegment(canonicalValue)) {
    return result({ recognized: true, valid: false, failureCode: "UNSAFE_CANONICAL_VALUE" });
  }
  if (isScoped && !isSafeSegment(productId || "")) {
    return result({ recognized: true, valid: false, failureCode: "UNSAFE_PRODUCT_ID" });
  }
  if (isScoped && !isSafeSegment(targetId || "")) {
    return result({ recognized: true, valid: false, failureCode: "UNSAFE_TARGET_ID" });
  }

  const action: ItemOptionAction = {
    type: "SELECT_ITEM_OPTION",
    rawId,
    fieldKey,
    canonicalValue,
    ...(productId ? { productId } : {}),
    ...(targetId ? { targetId } : {}),
  };
  return result({ recognized: true, valid: true, action });
}
