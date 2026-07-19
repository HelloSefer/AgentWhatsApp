import type { RequiredOrderField } from "../../config/required-fields.types";
import { evaluateCartIntegrity } from "../cart-state.service";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import { evaluateCartCommercialState } from "../commercial/cart-commercial-evaluation.service";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import {
  cloneDeliveryPreviewState,
  completedDeliveryUnits,
} from "./delivery-confirmation-snapshot.service";
import { normalizeDeliveryFieldValue } from "./delivery-field-normalizer.service";
import { getDeliveryRequirements } from "./delivery-requirements.service";
import type {
  DeliveryConfirmationFailureCode,
  DeliveryConfirmationPreviewInput,
  DeliveryConfirmationPreviewState,
  DeliveryRequirement,
} from "./delivery-confirmation.types";
import { DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION } from "./delivery-confirmation.types";

export function normalizeDeliveryFieldKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

export function hasDeliveryValue(value: unknown): value is SupportedOrderFieldValue {
  return typeof value === "string"
    ? Boolean(value.trim())
    : typeof value === "number"
      ? Number.isFinite(value)
      : typeof value === "boolean";
}

export function deliveryValuesEqual(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string"
    ? left === right
    : left === right;
}

function isPreviewState(value: unknown): value is DeliveryConfirmationPreviewState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION &&
    (candidate.kind === "COLLECTING_DELIVERY" ||
      candidate.kind === "FINAL_ORDER_REVIEW" ||
      candidate.kind === "EDITING_DELIVERY_FIELD" ||
      candidate.kind === "CONFIRMED_PREVIEW");
}

export function normalizeDeliveryPreviewState(
  value: unknown,
  cart: CartDraft,
): DeliveryConfirmationPreviewState | undefined {
  if (isPreviewState(value)) return cloneDeliveryPreviewState(value);
  if (value !== undefined) return undefined;
  if (cart.status === "CONFIRMED") {
    return { version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION, kind: "CONFIRMED_PREVIEW" };
  }
  if (cart.status === "AWAITING_CONFIRMATION") {
    return { version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION, kind: "FINAL_ORDER_REVIEW" };
  }
  if (cart.status === "COLLECTING_DELIVERY") {
    return { version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION, kind: "COLLECTING_DELIVERY" };
  }
  return undefined;
}

export function mapDeliveryReadinessFailure(value: string | undefined): DeliveryConfirmationFailureCode {
  if (value === "CURRENT_ITEM_PRESENT") return "CURRENT_ITEM_PRESENT";
  if (value === "TARGET_NOT_FULFILLED") return "TARGET_NOT_FULFILLED";
  if (value === "TARGET_OVERFILLED") return "TARGET_OVERFILLED";
  if (value === "EMPTY_CART") return "EMPTY_CART";
  if (value === "PRODUCT_MISMATCH") return "PRODUCT_MISMATCH";
  return "CART_NOT_READY_FOR_DELIVERY";
}

export function validateDeliveryCartLifecycle(
  input: DeliveryConfirmationPreviewInput,
  cart: CartDraft,
): DeliveryConfirmationFailureCode | undefined {
  if (!input.sellerId.trim() || input.sellerId.trim() !== input.productContext.sellerId.trim()) {
    return "PRODUCT_MISMATCH";
  }
  if (!input.conversationScopeId.trim()) return "INVALID_CONVERSATION_SCOPE";
  if (cart.status === "CONFIRMED" || cart.status === "CANCELLED") return "CONFIRMED_PREVIEW_LOCKED";
  if (cart.currentItemDraft) return "CURRENT_ITEM_PRESENT";
  if (!cart.items.length) return "EMPTY_CART";
  if (cart.items.some((item) => item.productId !== input.productContext.productId)) return "PRODUCT_MISMATCH";
  const integrity = evaluateCartIntegrity({ cart, fields: input.requiredFields });
  if (!integrity.valid) return "INVALID_CART";
  const target = cart.targetItemCount;
  const units = completedDeliveryUnits(cart);
  if (typeof target !== "number" || !Number.isSafeInteger(target) || target <= 0) return "CART_NOT_READY_FOR_DELIVERY";
  if (units > target) return "TARGET_OVERFILLED";
  if (units !== target) return "TARGET_NOT_FULFILLED";
  return undefined;
}

export function evaluateDeliveryCommercial(
  input: DeliveryConfirmationPreviewInput,
  cart: CartDraft,
): CartCommercialEvaluation {
  return evaluateCartCommercialState({
    sellerId: input.sellerId,
    productContext: input.productContext,
    fields: input.requiredFields,
    offerLookup: input.offerLookup,
    cart,
    now: input.now,
  });
}

export function getDeliveryCommercialFailure(
  commercial: CartCommercialEvaluation,
): DeliveryConfirmationFailureCode | undefined {
  if (commercial.state === "SELECTED_OFFER_INELIGIBLE") return "SELECTED_OFFER_INELIGIBLE";
  return commercial.cartValid && commercial.standardPricing ? undefined : "COMMERCIAL_STATE_BLOCKED";
}

export function getCurrentDeliveryRequirement(input: {
  requirements: readonly DeliveryRequirement[];
  cart: CartDraft;
  productContext: DeliveryConfirmationPreviewInput["productContext"];
}): DeliveryRequirement | undefined {
  return input.requirements.find((requirement) => {
    const value = input.cart.orderLevelFields[requirement.key];
    if (!hasDeliveryValue(value)) return true;
    return !normalizeDeliveryFieldValue({
      requirement,
      rawValue: value,
      productContext: input.productContext,
    }).valid;
  });
}

export function getDeliveryRequirementsFor(
  input: DeliveryConfirmationPreviewInput,
  cart: CartDraft,
): DeliveryRequirement[] {
  return getDeliveryRequirements({
    fields: input.requiredFields,
    cart,
    includeOptionalFieldKeys: input.includeOptionalFieldKeys,
  });
}

export type DeliveryCollectionContext = {
  requiredFields: RequiredOrderField[];
};
