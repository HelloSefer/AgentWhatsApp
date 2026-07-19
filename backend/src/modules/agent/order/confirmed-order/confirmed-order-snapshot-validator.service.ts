import { evaluateCartIntegrity, resolveCartFieldScope } from "../cart-state.service";
import { evaluateCartCommercialState } from "../commercial/cart-commercial-evaluation.service";
import { validateCandidateForField } from "../../order-understanding/contextual-field-validator.service";
import { normalizeDeliveryFieldValue } from "../delivery-confirmation/delivery-field-normalizer.service";
import { getDeliveryRequirements } from "../delivery-confirmation/delivery-requirements.service";
import type { DeliveryRequirement } from "../delivery-confirmation/delivery-confirmation.types";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import type {
  ConfirmedOrderSnapshotFailureCode,
  ConfirmedOrderSnapshotInput,
} from "./confirmed-order-snapshot.types";

export type ConfirmedOrderSnapshotValidation = Readonly<{
  valid: boolean;
  failureCode?: ConfirmedOrderSnapshotFailureCode;
  warnings: readonly string[];
  cart?: CartDraft;
  requirements?: readonly DeliveryRequirement[];
  commercialEvaluation?: CartCommercialEvaluation;
  snapshotId?: string;
  confirmedAt?: string;
}>;

function hasValue(value: unknown): value is SupportedOrderFieldValue {
  return typeof value === "string"
    ? Boolean(value.trim())
    : typeof value === "number"
      ? Number.isFinite(value)
      : typeof value === "boolean";
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function completedUnits(cart: CartDraft): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

function failure(
  failureCode: ConfirmedOrderSnapshotFailureCode,
  warnings: readonly string[] = [],
): ConfirmedOrderSnapshotValidation {
  return { valid: false, failureCode, warnings: [...warnings] };
}

function isSafePreviewId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{2,64}$/.test(value);
}

function isSafeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || /[\r\n\u0000]/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function resolvePreviewValue(
  supplied: unknown,
  factory: (() => string) | undefined,
): unknown {
  if (!factory) return supplied;
  try {
    return factory();
  } catch (_error) {
    return undefined;
  }
}

function hasMatchingConfirmedPreview(input: {
  source: ConfirmedOrderSnapshotInput;
  cart: CartDraft;
  requirements: readonly DeliveryRequirement[];
  confirmedAt: string;
}): boolean {
  const preview = input.source.confirmedPreview;
  if (!preview) return false;
  if (
    preview.sellerId !== input.source.sellerId ||
    preview.conversationScopeId !== input.source.conversationScopeId ||
    preview.confirmedAt !== input.confirmedAt ||
    preview.items.length !== input.cart.items.length
  ) {
    return false;
  }

  const previewItems = new Map(preview.items.map((item) => [item.id, item]));
  if (previewItems.size !== input.cart.items.length) return false;
  for (const item of input.cart.items) {
    const previewItem = previewItems.get(item.id);
    if (
      !previewItem ||
      previewItem.productId !== item.productId ||
      previewItem.quantity !== item.quantity ||
      previewItem.options.length !== Object.keys(item.selectedOptions).length
    ) {
      return false;
    }
    for (const option of previewItem.options) {
      if (item.selectedOptions[option.key] !== option.value) return false;
    }
  }

  return input.requirements.every((requirement) => {
    const value = input.cart.orderLevelFields[requirement.key];
    return preview.orderFields.some((field) => field.key === requirement.key && field.value === value);
  });
}

function validateItemOptions(input: {
  source: ConfirmedOrderSnapshotInput;
  cart: CartDraft;
}): ConfirmedOrderSnapshotFailureCode | undefined {
  const fieldsByKey = new Map(
    input.source.requiredFields
      .filter((field) => resolveCartFieldScope(field) === "ITEM")
      .map((field) => [normalizeKey(field.key), field]),
  );

  for (const item of input.cart.items) {
    for (const field of fieldsByKey.values()) {
      // Quantity is represented by the cart line itself, never by selectedOptions.
      if (normalizeKey(field.key) === "quantity") continue;
      const value = item.selectedOptions[field.key];
      const required = field.requirement === "REQUIRED" || (field.requirement === undefined && field.required);
      if (required && !hasValue(value)) return "INVALID_ITEM_OPTION";
      if (!hasValue(value)) continue;
      if (typeof value === "boolean") return "INVALID_ITEM_OPTION";
      const candidate = validateCandidateForField(
        {
          fieldKey: field.key,
          value,
          source: "deterministic_exact",
          operation: "SET",
          confidence: 1,
        },
        field,
        input.source.productContext as never,
      );
      if (!candidate.candidate) return "INVALID_ITEM_OPTION";
    }

    for (const key of Object.keys(item.selectedOptions)) {
      if (!fieldsByKey.has(normalizeKey(key))) return "INVALID_ITEM_OPTION";
    }
  }

  return undefined;
}

export function validateConfirmedOrderSnapshotInput(
  input: ConfirmedOrderSnapshotInput,
): ConfirmedOrderSnapshotValidation {
  if (!input.previewEnabled || input.previewState?.kind !== "CONFIRMED_PREVIEW") {
    return failure("PREVIEW_STATE_REQUIRED");
  }
  if (!input.cart || input.cart.status !== "CONFIRMED") return failure("CONFIRMED_PREVIEW_REQUIRED");
  const snapshotId = resolvePreviewValue(input.snapshotId, input.snapshotIdFactory);
  const confirmedAt = resolvePreviewValue(input.confirmedAt, input.confirmedAtFactory);
  if (!isSafePreviewId(snapshotId)) return failure("INVALID_SNAPSHOT_ID");
  if (!isSafeIsoTimestamp(confirmedAt)) return failure("INVALID_CONFIRMED_AT");
  if (!input.sellerId.trim() || input.sellerId.trim() !== input.productContext.sellerId.trim()) {
    return failure("PRODUCT_MISMATCH");
  }
  if (!input.conversationScopeId.trim()) return failure("INVALID_CONVERSATION_SCOPE");

  const cart = input.cart;
  if (cart.mode === "OFFER" && !cart.selectedOfferId) return failure("SELECTED_OFFER_INELIGIBLE");
  if (cart.currentItemDraft) return failure("CURRENT_ITEM_PRESENT");
  if (!cart.items.length) return failure("EMPTY_CART");
  if (cart.items.some((item) => item.productId !== input.productContext.productId)) return failure("PRODUCT_MISMATCH");
  if (typeof cart.targetItemCount !== "number" || !Number.isSafeInteger(cart.targetItemCount) || cart.targetItemCount <= 0) {
    return failure("TARGET_NOT_FULFILLED");
  }
  const units = completedUnits(cart);
  if (units > cart.targetItemCount) return failure("TARGET_OVERFILLED");
  if (units !== cart.targetItemCount) return failure("TARGET_NOT_FULFILLED");
  if (!evaluateCartIntegrity({ cart, fields: input.requiredFields }).valid) return failure("INVALID_CART");

  const optionalKeys = input.confirmedPreview?.orderFields.map((field) => field.key) || [];
  const requirements = getDeliveryRequirements({
    fields: input.requiredFields,
    cart,
    includeOptionalFieldKeys: optionalKeys,
  });
  for (const requirement of requirements) {
    const normalized = normalizeDeliveryFieldValue({
      requirement,
      rawValue: cart.orderLevelFields[requirement.key],
      productContext: input.productContext,
    });
    if (!normalized.valid) {
      return failure(hasValue(cart.orderLevelFields[requirement.key]) ? "INVALID_ORDER_FIELD" : "REQUIRED_ORDER_FIELD_MISSING");
    }
  }

  const optionFailure = validateItemOptions({ source: input, cart });
  if (optionFailure) return failure(optionFailure);
  if (!hasMatchingConfirmedPreview({ source: input, cart, requirements, confirmedAt })) {
    return failure("INVALID_CONFIRMED_PREVIEW");
  }
  if (
    (cart.selectedOfferId || undefined) !==
    (input.confirmedPreview?.selectedOffer?.offerId || undefined)
  ) {
    return failure("INVALID_CONFIRMED_PREVIEW");
  }

  const commercialEvaluation = evaluateCartCommercialState({
    sellerId: input.sellerId,
    productContext: input.productContext,
    fields: input.requiredFields,
    offerLookup: input.offerLookup,
    cart,
    now: input.now,
  });
  if (commercialEvaluation.selectedOffer && !commercialEvaluation.selectedOffer.eligible) {
    return failure("SELECTED_OFFER_INELIGIBLE", commercialEvaluation.warnings);
  }
  if (!commercialEvaluation.cartValid || !commercialEvaluation.standardPricing) {
    return failure("COMMERCIAL_STATE_BLOCKED", commercialEvaluation.warnings);
  }

  return {
    valid: true,
    cart,
    requirements,
    commercialEvaluation,
    snapshotId,
    confirmedAt,
    warnings: [...commercialEvaluation.warnings],
  };
}
