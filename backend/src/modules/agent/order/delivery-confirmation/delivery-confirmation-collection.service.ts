import type { RequiredOrderField } from "../../config/required-fields.types";
import type { DeliveryPricingConfig } from "../../config/seller-config.types";
import { setCartStatus, setConfiguredOrderLevelField } from "../cart-state.service";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import {
  buildDeliveryFieldPresentation,
  buildGroupedDeliveryFieldPresentation,
  buildFinalOrderReviewPresentation,
} from "./delivery-confirmation-presentation.service";
import {
  deliveryValuesEqual,
  evaluateDeliveryCommercial,
  getCurrentDeliveryRequirement,
  getDeliveryCommercialFailure,
  getDeliveryRequirementsFor,
  validateDeliveryCartLifecycle,
} from "./delivery-confirmation-context.service";
import { normalizeDeliveryFieldValue } from "./delivery-field-normalizer.service";
import {
  getInitialGroupedDeliveryRequirements,
  getRemainingGroupedDeliveryRequirements,
  parseGroupedDeliveryInput,
} from "./grouped-delivery-input.service";
import {
  buildFinalOrderReview,
  cloneDeliveryCart,
} from "./delivery-confirmation-snapshot.service";
import {
  createDeliveryConfirmationBlockedResult,
  createDeliveryConfirmationResult,
} from "./delivery-confirmation-result.service";
import type {
  DeliveryConfirmationAction,
  DeliveryConfirmationPreviewInput,
  DeliveryConfirmationPreviewResult,
  DeliveryConfirmationPreviewState,
  DeliveryRequirement,
} from "./delivery-confirmation.types";
import { DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION } from "./delivery-confirmation.types";

export function buildDeliveryCollectionResult(input: {
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  state: DeliveryConfirmationPreviewState;
  requirements: readonly DeliveryRequirement[];
  requiredFields: RequiredOrderField[];
  productContext: DeliveryConfirmationPreviewInput["productContext"];
  deliveryPricing?: DeliveryPricingConfig;
  commercial: CartCommercialEvaluation;
  changed: boolean;
  action?: DeliveryConfirmationAction;
  warnings?: string[];
}): DeliveryConfirmationPreviewResult {
  const grouped = getRemainingGroupedDeliveryRequirements({
    requirements: input.requirements,
    groupedFieldKeys: input.state.groupedFieldKeys,
    hasValue: (value) => typeof value === "string" ? Boolean(value.trim()) : typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean",
    orderFields: input.cartAfter.orderLevelFields,
  });
  if (grouped.length >= 2) {
    const state: DeliveryConfirmationPreviewState = {
      version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
      kind: "COLLECTING_DELIVERY",
      currentFieldKey: grouped[0]!.key,
      groupedFieldKeys: grouped.map((field) => field.key),
      ...(input.state.attempts ? { attempts: input.state.attempts } : {}),
    };
    return createDeliveryConfirmationResult({
      handled: true,
      success: true,
      changed: input.changed,
      cartBefore: input.cartBefore,
      cartAfter: input.cartAfter,
      previewState: state,
      presentation: buildGroupedDeliveryFieldPresentation(grouped),
      commercialEvaluation: input.commercial,
      ...(input.action ? { normalizedAction: input.action } : {}),
      nextStep: "COLLECT_ORDER_FIELD",
      warnings: input.warnings,
    });
  }
  const requirement = getCurrentDeliveryRequirement({
    requirements: input.requirements,
    cart: input.cartAfter,
    productContext: input.productContext,
  });
  if (requirement) {
    const state: DeliveryConfirmationPreviewState = {
      version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
      kind: "COLLECTING_DELIVERY",
      currentFieldKey: requirement.key,
      ...(input.state.attempts ? { attempts: input.state.attempts } : {}),
    };
    return createDeliveryConfirmationResult({
      handled: true,
      success: true,
      changed: input.changed,
      cartBefore: input.cartBefore,
      cartAfter: input.cartAfter,
      previewState: state,
      presentation: buildDeliveryFieldPresentation(requirement),
      commercialEvaluation: input.commercial,
      ...(input.action ? { normalizedAction: input.action } : {}),
      nextStep: "COLLECT_ORDER_FIELD",
      warnings: input.warnings,
    });
  }

  const commercialFailureCode = getDeliveryCommercialFailure(input.commercial);
  if (commercialFailureCode) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      cartAfter: input.cartAfter,
      previewState: input.state,
      failureCode: commercialFailureCode,
      commercial: input.commercial,
      action: input.action,
      resolveCommercial: true,
      warnings: input.warnings,
    });
  }
  const lifecycle = setCartStatus({ cart: input.cartAfter, status: "AWAITING_CONFIRMATION" });
  if (!lifecycle.accepted) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      previewState: input.state,
      failureCode: "CART_MUTATION_REJECTED",
    });
  }
  const review = buildFinalOrderReview({
    cart: lifecycle.cart,
    requirements: input.requirements,
    requiredFields: input.requiredFields,
    productContext: input.productContext,
    commercial: input.commercial,
    deliveryPricing: input.deliveryPricing,
  });
  if (!review) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      previewState: input.state,
      failureCode: "COMMERCIAL_STATE_BLOCKED",
      commercial: input.commercial,
      resolveCommercial: true,
    });
  }
  const state: DeliveryConfirmationPreviewState = {
    version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
    kind: "FINAL_ORDER_REVIEW",
  };
  return createDeliveryConfirmationResult({
    handled: true,
    success: true,
    changed: input.changed,
    cartBefore: input.cartBefore,
    cartAfter: lifecycle.cart,
    previewState: state,
    presentation: buildFinalOrderReviewPresentation(review),
    finalReview: review,
    commercialEvaluation: input.commercial,
    ...(input.action ? { normalizedAction: input.action } : {}),
    nextStep: "FINAL_ORDER_REVIEW",
    warnings: input.warnings,
  });
}

export function receiveGroupedDeliveryFieldValues(input: {
  source: DeliveryConfirmationPreviewInput;
  cartBefore: CartDraft;
  cart: CartDraft;
  state: DeliveryConfirmationPreviewState;
  requirements: readonly DeliveryRequirement[];
  rawValue: string;
}): DeliveryConfirmationPreviewResult {
  const grouped = getRemainingGroupedDeliveryRequirements({
    requirements: input.requirements,
    groupedFieldKeys: input.state.groupedFieldKeys,
    hasValue: (value) => typeof value === "string" ? Boolean(value.trim()) : typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean",
    orderFields: input.cart.orderLevelFields,
  });
  if (grouped.length < 2) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      previewState: input.state,
      failureCode: "FIELD_NOT_CURRENTLY_EXPECTED",
    });
  }

  const parsed = parseGroupedDeliveryInput({
    rawText: input.rawValue,
    requirements: grouped,
    productContext: input.source.productContext,
  });
  let cartAfter = input.cart;
  let changed = false;
  for (const requirement of grouped) {
    const value = parsed.values.get(requirement.key);
    if (value === undefined) continue;
    const previous = cartAfter.orderLevelFields[requirement.key];
    const mutation = setConfiguredOrderLevelField({
      cart: cartAfter,
      fields: input.source.requiredFields,
      fieldKey: requirement.key,
      value: value as SupportedOrderFieldValue,
    });
    if (!mutation.accepted) {
      return createDeliveryConfirmationBlockedResult({
        cartBefore: input.cartBefore,
        previewState: input.state,
        failureCode: "CART_MUTATION_REJECTED",
      });
    }
    cartAfter = mutation.cart;
    changed ||= !deliveryValuesEqual(previous, value as SupportedOrderFieldValue);
  }

  const requirements = getDeliveryRequirementsFor(input.source, cartAfter);
  const remainingGrouped = getRemainingGroupedDeliveryRequirements({
    requirements,
    groupedFieldKeys: input.state.groupedFieldKeys,
    hasValue: (value) => typeof value === "string" ? Boolean(value.trim()) : typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean",
    orderFields: cartAfter.orderLevelFields,
  });
  const state: DeliveryConfirmationPreviewState = {
    version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
    kind: "COLLECTING_DELIVERY",
    ...(remainingGrouped.length ? { currentFieldKey: remainingGrouped[0]!.key } : {}),
    ...(remainingGrouped.length >= 2 ? { groupedFieldKeys: remainingGrouped.map((field) => field.key) } : {}),
    ...(parsed.invalidFieldKeys.length || input.state.attempts
      ? { attempts: Math.min((input.state.attempts || 0) + (parsed.invalidFieldKeys.length ? 1 : 0), 9) }
      : {}),
  };
  const commercial = evaluateDeliveryCommercial(input.source, cartAfter);
  const result = buildDeliveryCollectionResult({
    cartBefore: input.cartBefore,
    cartAfter,
    state,
    requirements,
    requiredFields: input.source.requiredFields,
    productContext: input.source.productContext,
    deliveryPricing: input.source.deliveryPricing,
    commercial,
    changed,
    warnings: [...commercial.warnings, ...parsed.invalidFieldKeys.map((key) => `INVALID_GROUPED_DELIVERY_FIELD:${key}`)],
  });

  const savedLabels = grouped
    .filter((field) => parsed.values.has(field.key))
    .map((field) => field.label);
  const invalidRequirement = grouped.find((field) => parsed.invalidFieldKeys.includes(field.key));
  if (!result.presentation || (!savedLabels.length && !invalidRequirement)) return result;

  const prefix = invalidRequirement
    ? `${savedLabels.length ? `${savedLabels.join(" و")} تسجلو ✅\n` : ""}غير ${invalidRequirement.label} ما بانش صحيح.`
    : result.nextStep === "COLLECT_ORDER_FIELD" && remainingGrouped.length === 0
      ? `تمام، تسجلو ${savedLabels.join(" و")} ✅`
      : "";
  if (!prefix) return result;
  return {
    ...result,
    presentation: {
      ...result.presentation,
      text: [prefix, result.presentation.text].filter(Boolean).join("\n"),
    },
  };
}

export function renderDeliveryFinalReview(input: {
  source: DeliveryConfirmationPreviewInput;
  cartBefore: CartDraft;
  cart: CartDraft;
  requirements: readonly DeliveryRequirement[];
  state: DeliveryConfirmationPreviewState;
  changed: boolean;
  action?: DeliveryConfirmationAction;
  warnings?: string[];
}): DeliveryConfirmationPreviewResult {
  const lifecycleFailure = validateDeliveryCartLifecycle(input.source, input.cart);
  if (lifecycleFailure) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      cartAfter: input.cart,
      previewState: input.state,
      failureCode: lifecycleFailure,
      action: input.action,
      warnings: input.warnings,
    });
  }
  const missing = getCurrentDeliveryRequirement({
    requirements: input.requirements,
    cart: input.cart,
    productContext: input.source.productContext,
  });
  if (missing) {
    return createDeliveryConfirmationResult({
      handled: true,
      success: false,
      changed: false,
      cartBefore: input.cartBefore,
      cartAfter: input.cart,
      previewState: {
        version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
        kind: "COLLECTING_DELIVERY",
        currentFieldKey: missing.key,
      },
      presentation: buildDeliveryFieldPresentation(missing),
      ...(input.action ? { normalizedAction: input.action } : {}),
      nextStep: "COLLECT_ORDER_FIELD",
      failureCode: "CONFIRMATION_NOT_READY",
      warnings: input.warnings,
    });
  }
  const commercial = evaluateDeliveryCommercial(input.source, input.cart);
  const commercialFailureCode = getDeliveryCommercialFailure(commercial);
  if (commercialFailureCode) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      cartAfter: input.cart,
      previewState: input.state,
      failureCode: commercialFailureCode,
      commercial,
      action: input.action,
      resolveCommercial: true,
      warnings: input.warnings,
    });
  }
  const lifecycle = input.cart.status === "AWAITING_CONFIRMATION"
    ? { cart: cloneDeliveryCart(input.cart), accepted: true }
    : setCartStatus({ cart: input.cart, status: "AWAITING_CONFIRMATION" });
  if (!lifecycle.accepted) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      cartAfter: input.cart,
      previewState: input.state,
      failureCode: "CART_MUTATION_REJECTED",
      commercial,
      action: input.action,
      warnings: input.warnings,
    });
  }
  const finalReview = buildFinalOrderReview({
    cart: lifecycle.cart,
    requirements: input.requirements,
    requiredFields: input.source.requiredFields,
    productContext: input.source.productContext,
    commercial,
    deliveryPricing: input.source.deliveryPricing,
  });
  if (!finalReview) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      cartAfter: input.cart,
      previewState: input.state,
      failureCode: "COMMERCIAL_STATE_BLOCKED",
      commercial,
      action: input.action,
      resolveCommercial: true,
      warnings: input.warnings,
    });
  }
  const state: DeliveryConfirmationPreviewState = {
    version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
    kind: "FINAL_ORDER_REVIEW",
  };
  return createDeliveryConfirmationResult({
    handled: true,
    success: true,
    changed: input.changed,
    cartBefore: input.cartBefore,
    cartAfter: lifecycle.cart,
    previewState: state,
    presentation: buildFinalOrderReviewPresentation(finalReview),
    finalReview,
    commercialEvaluation: commercial,
    ...(input.action ? { normalizedAction: input.action } : {}),
    nextStep: "FINAL_ORDER_REVIEW",
    warnings: [...(input.warnings || []), ...commercial.warnings],
  });
}

export function receiveDeliveryFieldValue(input: {
  source: DeliveryConfirmationPreviewInput;
  cartBefore: CartDraft;
  cart: CartDraft;
  state: DeliveryConfirmationPreviewState;
  requirement: DeliveryRequirement;
  rawValue: unknown;
  action?: DeliveryConfirmationAction;
  editing: boolean;
}): DeliveryConfirmationPreviewResult {
  const normalization = normalizeDeliveryFieldValue({
    requirement: input.requirement,
    rawValue: input.rawValue,
    productContext: input.source.productContext,
  });
  if (!normalization.valid) {
    const nextState: DeliveryConfirmationPreviewState = {
      version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
      kind: input.editing ? "EDITING_DELIVERY_FIELD" : "COLLECTING_DELIVERY",
      ...(input.editing ? { editingFieldKey: input.requirement.key } : { currentFieldKey: input.requirement.key }),
      attempts: Math.min((input.state.attempts || 0) + 1, 9),
    };
    return createDeliveryConfirmationResult({
      handled: true,
      success: false,
      changed: false,
      cartBefore: input.cartBefore,
      cartAfter: input.cart,
      previewState: nextState,
      presentation: buildDeliveryFieldPresentation(input.requirement),
      ...(input.action ? { normalizedAction: input.action } : {}),
      nextStep: input.editing ? "EDIT_ORDER_FIELD" : "COLLECT_ORDER_FIELD",
      failureCode: "INVALID_FIELD_VALUE",
      warnings: [normalization.failureCode],
    });
  }

  const previous = input.cart.orderLevelFields[input.requirement.key];
  const mutation = setConfiguredOrderLevelField({
    cart: input.cart,
    fields: input.source.requiredFields,
    fieldKey: input.requirement.key,
    value: normalization.value,
  });
  if (!mutation.accepted) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      previewState: input.state,
      failureCode: "CART_MUTATION_REJECTED",
      action: input.action,
    });
  }
  const changed = !deliveryValuesEqual(previous, normalization.value);
  const requirements = getDeliveryRequirementsFor(input.source, mutation.cart);
  if (input.editing) {
    return renderDeliveryFinalReview({
      source: input.source,
      cartBefore: input.cartBefore,
      cart: mutation.cart,
      requirements,
      state: input.state,
      changed,
      action: input.action,
    });
  }
  const commercial = evaluateDeliveryCommercial(input.source, mutation.cart);
  return buildDeliveryCollectionResult({
    cartBefore: input.cartBefore,
    cartAfter: mutation.cart,
    state: input.state,
    requirements,
    requiredFields: input.source.requiredFields,
    productContext: input.source.productContext,
    deliveryPricing: input.source.deliveryPricing,
    commercial,
    changed,
    action: input.action,
    warnings: [...commercial.warnings],
  });
}

export function startDeliveryCollection(input: {
  source: DeliveryConfirmationPreviewInput;
  cartBefore: CartDraft;
}): DeliveryConfirmationPreviewResult {
  if (input.source.cartReviewPreviewState && input.source.cartReviewPreviewState.awaitingInput.kind !== "NONE") {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      failureCode: "CONFLICTING_CART_REVIEW_STATE",
    });
  }
  if (input.source.cartItemEditPreviewState) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      failureCode: "CONFLICTING_ITEM_EDIT_STATE",
    });
  }
  if (input.cartBefore.status !== "CART_REVIEW") {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      failureCode: "CART_NOT_READY_FOR_DELIVERY",
    });
  }
  const lifecycleFailure = validateDeliveryCartLifecycle(input.source, input.cartBefore);
  if (lifecycleFailure) {
    return createDeliveryConfirmationBlockedResult({ cartBefore: input.cartBefore, failureCode: lifecycleFailure });
  }
  const commercial = evaluateDeliveryCommercial(input.source, input.cartBefore);
  const commercialFailureCode = getDeliveryCommercialFailure(commercial);
  if (commercialFailureCode) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      failureCode: commercialFailureCode,
      commercial,
      resolveCommercial: true,
      warnings: [...commercial.warnings],
    });
  }
  const lifecycle = setCartStatus({ cart: input.cartBefore, status: "COLLECTING_DELIVERY" });
  if (!lifecycle.accepted) {
    return createDeliveryConfirmationBlockedResult({ cartBefore: input.cartBefore, failureCode: "CART_MUTATION_REJECTED" });
  }
  const requirements = getDeliveryRequirementsFor(input.source, lifecycle.cart);
  const grouped = getInitialGroupedDeliveryRequirements(
    requirements,
    (value) => typeof value === "string" ? Boolean(value.trim()) : typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean",
    lifecycle.cart.orderLevelFields,
  );
  const state: DeliveryConfirmationPreviewState = {
    version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
    kind: "COLLECTING_DELIVERY",
    ...(grouped.length ? { currentFieldKey: grouped[0]!.key, groupedFieldKeys: grouped.map((field) => field.key) } : {}),
  };
  return buildDeliveryCollectionResult({
    cartBefore: input.cartBefore,
    cartAfter: lifecycle.cart,
    state,
    requirements,
    requiredFields: input.source.requiredFields,
    productContext: input.source.productContext,
    deliveryPricing: input.source.deliveryPricing,
    commercial,
    changed: true,
    warnings: [...commercial.warnings],
  });
}
