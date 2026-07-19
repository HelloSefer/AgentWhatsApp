import type {
  DeliveryConfirmationAction,
  DeliveryConfirmationActionNormalizationResult,
} from "./delivery-confirmation.types";

const ACTION_PREFIX = "order_checkout";
const FIELD_ACTION_PREFIX = "order_checkout_field";
const MAX_ACTION_ID_LENGTH = 200;
const MAX_ACTION_SEGMENT_LENGTH = 80;
const UNSAFE_ACTION_SEGMENT = /[:%\s\u0000-\u001F\u007F-\u009F]/u;

function isSafeSegment(value: string): boolean {
  return (
    Boolean(value) &&
    Array.from(value).length <= MAX_ACTION_SEGMENT_LENGTH &&
    !UNSAFE_ACTION_SEGMENT.test(value)
  );
}

/** Recognizes only explicit checkout action namespaces, never customer text. */
export function normalizeDeliveryConfirmationAction(
  rawId: unknown,
): DeliveryConfirmationActionNormalizationResult {
  if (typeof rawId !== "string" || (!rawId.startsWith(`${ACTION_PREFIX}:`) && !rawId.startsWith(`${FIELD_ACTION_PREFIX}:`))) {
    return { recognized: false, valid: false, failureCode: "NOT_DELIVERY_CONFIRMATION_ACTION" };
  }
  if (Array.from(rawId).length > MAX_ACTION_ID_LENGTH) {
    return { recognized: true, valid: false, failureCode: "ACTION_ID_TOO_LONG" };
  }

  const segments = rawId.split(":");
  if (segments[0] === ACTION_PREFIX) {
    if (segments.length !== 2) {
      return { recognized: true, valid: false, failureCode: segments.length > 2 ? "EXTRA_ACTION_SEGMENT" : "MALFORMED_ACTION_ID" };
    }
    const action = segments[1];
    if (action === "confirm") return { recognized: true, valid: true, action: { type: "CONFIRM", rawId: "order_checkout:confirm" } };
    if (action === "edit_delivery") return { recognized: true, valid: true, action: { type: "EDIT_DELIVERY", rawId: "order_checkout:edit_delivery" } };
    if (action === "back_to_cart") return { recognized: true, valid: true, action: { type: "BACK_TO_CART", rawId: "order_checkout:back_to_cart" } };
    if (action === "cancel_edit") return { recognized: true, valid: true, action: { type: "CANCEL_EDIT", rawId: "order_checkout:cancel_edit" } };
    return { recognized: true, valid: false, failureCode: "MALFORMED_ACTION_ID" };
  }

  if (segments.length !== 3 && segments.length !== 4) {
    return { recognized: true, valid: false, failureCode: segments.length > 4 ? "EXTRA_ACTION_SEGMENT" : "MALFORMED_ACTION_ID" };
  }
  if (segments[0] !== FIELD_ACTION_PREFIX || !["select", "value"].includes(segments[1])) {
    return { recognized: true, valid: false, failureCode: "MALFORMED_ACTION_ID" };
  }
  if (segments[1] === "select" && segments.length !== 3) {
    return { recognized: true, valid: false, failureCode: "EXTRA_ACTION_SEGMENT" };
  }
  if (segments[1] === "value" && segments.length !== 4) {
    return { recognized: true, valid: false, failureCode: "MALFORMED_ACTION_ID" };
  }
  const fieldKey = segments[2];
  if (!isSafeSegment(fieldKey)) {
    return { recognized: true, valid: false, failureCode: "UNSAFE_FIELD_KEY" };
  }
  if (segments[1] === "select") {
    return { recognized: true, valid: true, action: { type: "SELECT_FIELD", rawId, fieldKey } };
  }
  const canonicalValue = segments[3];
  if (!isSafeSegment(canonicalValue)) {
    return { recognized: true, valid: false, failureCode: "UNSAFE_CANONICAL_VALUE" };
  }
  return {
    recognized: true,
    valid: true,
    action: { type: "SELECT_FIELD_VALUE", rawId, fieldKey, canonicalValue },
  };
}
