import { MAX_PRODUCT_OFFER_ID_LENGTH } from "../../../config/offers/offer.types";
import { MAX_CART_TARGET_ITEM_COUNT } from "../../cart-state.service";
import { MAX_CART_PLANNING_ACTION_ID_LENGTH } from "../presentation/cart-planning-presentation.types";
import type {
  CartPlanningAction,
  CartPlanningActionNormalizationResult,
} from "./cart-planning-action.types";

const OFFER_PREFIX = "cart_offer:";
const QUANTITY_PREFIX = "cart_quantity:";
const CONTROL_OR_WHITESPACE = /[\s\u0000-\u001F\u007F-\u009F]/u;
const SAFE_OFFER_ID = /^[^:\s\u0000-\u001F\u007F-\u009F]+$/u;
const NORMALIZED_QUANTITY = /^[1-9][0-9]*$/u;

function invalid(
  failureCode: Exclude<CartPlanningActionNormalizationResult["failureCode"], "NOT_PLANNING_ACTION">,
): CartPlanningActionNormalizationResult {
  return { recognized: true, valid: false, failureCode };
}

function isSafeOfferId(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(value).length <= MAX_PRODUCT_OFFER_ID_LENGTH &&
    !CONTROL_OR_WHITESPACE.test(value) &&
    SAFE_OFFER_ID.test(value)
  );
}

function valid(action: CartPlanningAction): CartPlanningActionNormalizationResult {
  return { recognized: true, valid: true, action };
}

/**
 * Parses only planning-specific stable IDs. Generic WhatsApp interaction
 * payload parsing remains owned by the Cloud normalizer.
 */
export function normalizeCartPlanningAction(
  rawActionId: unknown,
): CartPlanningActionNormalizationResult {
  if (typeof rawActionId !== "string") {
    return { recognized: false, valid: false, failureCode: "NOT_PLANNING_ACTION" };
  }

  const isOfferAction = rawActionId.startsWith(OFFER_PREFIX);
  const isQuantityAction = rawActionId.startsWith(QUANTITY_PREFIX);
  if (!isOfferAction && !isQuantityAction) {
    return { recognized: false, valid: false, failureCode: "NOT_PLANNING_ACTION" };
  }

  if (rawActionId.length > MAX_CART_PLANNING_ACTION_ID_LENGTH) {
    return invalid("ACTION_ID_TOO_LONG");
  }

  if (isOfferAction) {
    const offerId = rawActionId.slice(OFFER_PREFIX.length);
    if (!offerId) {
      return invalid("EMPTY_OFFER_ID");
    }

    if (!isSafeOfferId(offerId)) {
      return invalid("INVALID_OFFER_ID");
    }

    return valid({ type: "SELECT_OFFER", rawId: rawActionId, offerId });
  }

  const quantityValue = rawActionId.slice(QUANTITY_PREFIX.length);
  if (quantityValue === "more") {
    return valid({ type: "REQUEST_MORE_QUANTITY", rawId: rawActionId });
  }

  if (!quantityValue) {
    return invalid("INVALID_QUANTITY");
  }

  if (CONTROL_OR_WHITESPACE.test(quantityValue) || !NORMALIZED_QUANTITY.test(quantityValue)) {
    return /^[a-z]/iu.test(quantityValue)
      ? invalid("UNSUPPORTED_QUANTITY_ACTION")
      : invalid("INVALID_QUANTITY");
  }

  const quantity = Number(quantityValue);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_CART_TARGET_ITEM_COUNT) {
    return invalid("INVALID_QUANTITY");
  }

  return valid({
    type: "SELECT_STANDARD_QUANTITY",
    rawId: rawActionId,
    quantity,
  });
}
