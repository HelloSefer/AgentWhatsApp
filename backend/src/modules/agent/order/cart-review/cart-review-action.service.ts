import {
  MAX_CART_REVIEW_ACTION_ID_LENGTH,
  MAX_CART_REVIEW_ITEM_ID_LENGTH,
  type CartReviewActionNormalizationResult,
} from "./cart-review.types";

const TOP_LEVEL_ACTIONS = {
  "cart_review:continue": { type: "CONTINUE", rawId: "cart_review:continue" },
  "cart_review:add_item": { type: "ADD_ITEM", rawId: "cart_review:add_item" },
  "cart_review:edit": { type: "EDIT", rawId: "cart_review:edit" },
  "cart_review:back": { type: "BACK", rawId: "cart_review:back" },
  "cart_review:use_standard": { type: "USE_STANDARD", rawId: "cart_review:use_standard" },
} as const;

const ITEM_ACTION_PREFIX = "cart_review_item:";
const SAFE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

function invalid(failureCode: CartReviewActionNormalizationResult["failureCode"]): CartReviewActionNormalizationResult {
  return { recognized: true, valid: false, failureCode };
}

function isSafeItemId(value: string): boolean {
  return (
    Array.from(value).length > 0 &&
    Array.from(value).length <= MAX_CART_REVIEW_ITEM_ID_LENGTH &&
    SAFE_ITEM_ID.test(value) &&
    !/^\d+$/u.test(value)
  );
}

/** Accepts only stable cart-review IDs; labels and normal text are never authority. */
export function normalizeCartReviewAction(rawId: unknown): CartReviewActionNormalizationResult {
  if (typeof rawId !== "string") {
    return { recognized: false, valid: false, failureCode: "NOT_CART_REVIEW_ACTION" };
  }

  if (rawId in TOP_LEVEL_ACTIONS) {
    return {
      recognized: true,
      valid: true,
      action: TOP_LEVEL_ACTIONS[rawId as keyof typeof TOP_LEVEL_ACTIONS],
    };
  }

  if (!rawId.startsWith("cart_review:") && !rawId.startsWith(ITEM_ACTION_PREFIX)) {
    return { recognized: false, valid: false, failureCode: "NOT_CART_REVIEW_ACTION" };
  }

  if (Array.from(rawId).length > MAX_CART_REVIEW_ACTION_ID_LENGTH) {
    return invalid("MALFORMED_CART_REVIEW_ACTION");
  }

  const segments = rawId.split(":");
  if (segments[0] !== "cart_review_item") {
    return invalid("MALFORMED_CART_REVIEW_ACTION");
  }

  if (segments.length === 4 && segments[1] === "option") {
    const [, , fieldKey, itemId] = segments;
    if (!isSafeItemId(itemId) || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(fieldKey)) {
      return invalid("MALFORMED_CART_REVIEW_ACTION");
    }
    return {
      recognized: true,
      valid: true,
      action: { type: "EDIT_ITEM_OPTION", rawId, itemId, fieldKey },
    };
  }

  if (segments.length !== 3) {
    return invalid("MALFORMED_CART_REVIEW_ACTION");
  }

  const [, operation, itemId] = segments;
  if (!isSafeItemId(itemId)) {
    return invalid("UNSAFE_CART_ITEM_ID");
  }

  if (operation === "select") {
    return { recognized: true, valid: true, action: { type: "SELECT_ITEM", rawId: rawId as `cart_review_item:select:${string}`, itemId } };
  }
  if (operation === "quantity") {
    return { recognized: true, valid: true, action: { type: "EDIT_ITEM_QUANTITY", rawId: rawId as `cart_review_item:quantity:${string}`, itemId } };
  }
  if (operation === "options") {
    return { recognized: true, valid: true, action: { type: "EDIT_ITEM_OPTIONS", rawId: rawId as `cart_review_item:options:${string}`, itemId } };
  }
  if (operation === "remove") {
    return { recognized: true, valid: true, action: { type: "REMOVE_ITEM", rawId: rawId as `cart_review_item:remove:${string}`, itemId } };
  }

  return invalid("MALFORMED_CART_REVIEW_ACTION");
}
