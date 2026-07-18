import { normalizeCartCustomQuantityInput } from "../../planning/quantity/cart-quantity-input-normalizer.service";
import type {
  CurrentItemQuantityNormalizationInput,
  CurrentItemQuantityResult,
} from "./current-item-quantity.types";

/**
 * Reuses the established pure quantity parser and adds only the current
 * item's trusted remaining-unit bound. Progression gating lives in the loop.
 */
export function normalizeCurrentItemQuantity(
  input: CurrentItemQuantityNormalizationInput,
): CurrentItemQuantityResult {
  const normalized = normalizeCartCustomQuantityInput(input.text);
  if (!normalized.success || normalized.quantity === undefined) {
    return { ...normalized };
  }

  if (!Number.isSafeInteger(input.remainingUnits) || input.remainingUnits <= 0 || normalized.quantity > input.remainingUnits) {
    return {
      success: false,
      normalizedText: normalized.normalizedText,
      failureCode: "QUANTITY_EXCEEDS_REMAINING_TARGET",
    };
  }

  return { ...normalized };
}
