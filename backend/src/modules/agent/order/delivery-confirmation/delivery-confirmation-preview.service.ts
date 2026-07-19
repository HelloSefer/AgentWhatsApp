import type { CartDraft } from "../cart-state.types";
import { normalizeDeliveryConfirmationAction } from "./delivery-confirmation-action.service";
import { runDeliveryConfirmationService } from "./delivery-confirmation.service";
import type {
  DeliveryConfirmationPreviewInput,
  DeliveryConfirmationPreviewResult,
} from "./delivery-confirmation.types";

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

function emptyCart(): CartDraft {
  return {
    schemaVersion: 1,
    mode: "STANDARD",
    status: "EMPTY",
    items: [],
    orderLevelFields: {},
  };
}

function unhandled(input: DeliveryConfirmationPreviewInput): DeliveryConfirmationPreviewResult {
  const cart = cloneCart(input.cart || emptyCart());
  return {
    handled: false,
    success: false,
    changed: false,
    cartBefore: cart,
    cartAfter: cloneCart(cart),
    warnings: [],
  };
}

/** Explicit controller-only Preview adapter. It never touches live sessions or transports. */
export function runDeliveryConfirmationPreview(
  input: DeliveryConfirmationPreviewInput,
): DeliveryConfirmationPreviewResult {
  if (!input.previewEnabled) return unhandled(input);

  if (input.rawActionId !== undefined) {
    const normalization = normalizeDeliveryConfirmationAction(input.rawActionId);
    if (!normalization.recognized) return unhandled(input);
    if (!normalization.valid || !normalization.action) {
      const cart = cloneCart(input.cart || emptyCart());
      return {
        handled: true,
        success: false,
        changed: false,
        cartBefore: cart,
        cartAfter: cloneCart(cart),
        ...(input.previewState ? { previewState: { ...input.previewState } } : {}),
        nextStep: "BLOCKED",
        failureCode: normalization.failureCode,
        warnings: [],
      };
    }
    return runDeliveryConfirmationService({ ...input, action: normalization.action });
  }

  return runDeliveryConfirmationService(input);
}
