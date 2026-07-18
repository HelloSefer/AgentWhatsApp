import type { CartDraft } from "../../../cart-state.types";
import { selectStandardTargetQuantity } from "../../cart-planning.service";
import { normalizeCartCustomQuantityInput } from "../cart-quantity-input-normalizer.service";
import {
  MAX_CUSTOM_QUANTITY_ATTEMPTS,
  type CartCustomQuantityFlowInput,
  type CartCustomQuantityFlowResult,
  type CartPlanningAwaitingInput,
} from "./cart-custom-quantity-flow.types";

function cloneCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map((item) => ({ ...item, selectedOptions: { ...item.selectedOptions } })),
    currentItemDraft: cart.currentItemDraft
      ? { ...cart.currentItemDraft, selectedOptions: { ...cart.currentItemDraft.selectedOptions } }
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

function normalizeAwaitingInput(value: CartPlanningAwaitingInput): CartPlanningAwaitingInput {
  if (value.kind !== "CUSTOM_QUANTITY") {
    return { kind: "NONE" };
  }

  const attempts = Number.isSafeInteger(value.attempts)
    ? Math.max(0, Math.min(MAX_CUSTOM_QUANTITY_ATTEMPTS, value.attempts))
    : 0;
  const startedAt = typeof value.startedAt === "string" && value.startedAt.trim()
    ? value.startedAt.trim()
    : undefined;

  return { kind: "CUSTOM_QUANTITY", attempts, ...(startedAt ? { startedAt } : {}) };
}

function baseResult(input: {
  cart: CartDraft;
  awaitingInput: CartPlanningAwaitingInput;
  handled: boolean;
  success: boolean;
  warnings?: string[];
  failureCode?: string;
}): CartCustomQuantityFlowResult {
  return {
    handled: input.handled,
    success: input.success,
    awaitingInput: normalizeAwaitingInput(input.awaitingInput),
    cartBefore: cloneCart(input.cart),
    cartAfter: cloneCart(input.cart),
    warnings: [...(input.warnings || [])],
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  };
}

/** Starts or safely replays the preview-only custom quantity awaiting state. */
export function beginCartCustomQuantityAwaiting(input: {
  cart: CartDraft;
  awaitingInput?: CartPlanningAwaitingInput;
}): CartCustomQuantityFlowResult {
  const awaitingInput = input.awaitingInput?.kind === "CUSTOM_QUANTITY"
    ? normalizeAwaitingInput(input.awaitingInput)
    : { kind: "CUSTOM_QUANTITY" as const, attempts: 0 };

  return {
    ...baseResult({ cart: input.cart, awaitingInput, handled: true, success: true }),
    nextStep: "REQUEST_CUSTOM_QUANTITY",
  };
}

/**
 * Applies C3A parsing only while the explicit preview state awaits a custom
 * quantity. Exhaustion clears the preview-only state to avoid endless retries.
 */
export function handleCartCustomQuantityInput(
  input: CartCustomQuantityFlowInput,
): CartCustomQuantityFlowResult {
  const awaitingInput = normalizeAwaitingInput(input.awaitingInput);
  if (awaitingInput.kind !== "CUSTOM_QUANTITY") {
    return baseResult({ cart: input.cart, awaitingInput, handled: false, success: false });
  }

  if (awaitingInput.attempts >= MAX_CUSTOM_QUANTITY_ATTEMPTS) {
    return {
      ...baseResult({
        cart: input.cart,
        awaitingInput: { kind: "NONE" },
        handled: true,
        success: false,
        failureCode: "CUSTOM_QUANTITY_EXHAUSTED",
      }),
      nextStep: "CUSTOM_QUANTITY_EXHAUSTED",
    };
  }

  const quantityResult = normalizeCartCustomQuantityInput(input.planningText);
  if (!quantityResult.success || quantityResult.quantity === undefined) {
    const attempts = awaitingInput.attempts + 1;
    const exhausted = attempts >= MAX_CUSTOM_QUANTITY_ATTEMPTS;
    const nextAwaitingInput: CartPlanningAwaitingInput = exhausted
      ? { kind: "NONE" }
      : { ...awaitingInput, attempts };

    return {
      ...baseResult({
        cart: input.cart,
        awaitingInput: nextAwaitingInput,
        handled: true,
        success: false,
        failureCode: exhausted ? "CUSTOM_QUANTITY_EXHAUSTED" : quantityResult.failureCode,
      }),
      quantityResult,
      nextStep: exhausted ? "CUSTOM_QUANTITY_EXHAUSTED" : "RETRY_CUSTOM_QUANTITY",
    };
  }

  const planningResult = selectStandardTargetQuantity(
    input.planningContext,
    quantityResult.quantity,
  );
  if (!planningResult.success) {
    return {
      ...baseResult({
        cart: input.cart,
        awaitingInput,
        handled: true,
        success: false,
        failureCode: planningResult.failureCode,
        warnings: planningResult.warnings,
      }),
      quantityResult,
      planningResult,
    };
  }

  return {
    ...baseResult({ cart: input.cart, awaitingInput: { kind: "NONE" }, handled: true, success: true }),
    quantityResult,
    planningResult,
    cartAfter: cloneCart(planningResult.cart),
    nextStep: "START_ITEM_COLLECTION",
  };
}
