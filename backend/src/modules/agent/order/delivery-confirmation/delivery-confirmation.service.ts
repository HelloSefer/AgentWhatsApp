import { setCartStatus } from "../cart-state.service";
import type { CartDraft } from "../cart-state.types";
import {
  buildCommercialResolutionPresentation,
  buildDeliveryFieldPresentation,
  buildDeliveryFieldSelectorPresentation,
} from "./delivery-confirmation-presentation.service";
import {
  evaluateDeliveryCommercial,
  getCurrentDeliveryRequirement,
  getDeliveryCommercialFailure,
  getDeliveryRequirementsFor,
  normalizeDeliveryFieldKey,
  normalizeDeliveryPreviewState,
  validateDeliveryCartLifecycle,
} from "./delivery-confirmation-context.service";
import {
  buildDeliveryCollectionResult,
  receiveDeliveryFieldValue,
  renderDeliveryFinalReview,
  startDeliveryCollection,
} from "./delivery-confirmation-collection.service";
import { findDeliveryRequirement } from "./delivery-requirements.service";
import {
  buildConfirmedOrderPreview,
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
} from "./delivery-confirmation.types";
import { DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION } from "./delivery-confirmation.types";

function renderConfirmedPreview(input: {
  source: DeliveryConfirmationPreviewInput;
  cartBefore: CartDraft;
  state: DeliveryConfirmationPreviewState;
  action?: DeliveryConfirmationAction;
}): DeliveryConfirmationPreviewResult {
  const requirements = getDeliveryRequirementsFor(input.source, input.cartBefore);
  const commercial = evaluateDeliveryCommercial(input.source, input.cartBefore);
  const review = buildFinalOrderReview({
    cart: input.cartBefore,
    requirements,
    requiredFields: input.source.requiredFields,
    productContext: input.source.productContext,
    commercial,
    deliveryPricing: input.source.deliveryPricing,
  });
  if (!review) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore: input.cartBefore,
      previewState: input.state,
      failureCode: "COMMERCIAL_STATE_BLOCKED",
      commercial,
      action: input.action,
      resolveCommercial: true,
    });
  }
  const confirmedAt = input.state.confirmedAt || (Number.isNaN(input.source.now.getTime()) ? "" : input.source.now.toISOString());
  const preview = buildConfirmedOrderPreview({
    finalReview: review,
    sellerId: input.source.sellerId,
    conversationScopeId: input.source.conversationScopeId,
    confirmedAt,
  });
  return createDeliveryConfirmationResult({
    handled: true,
    success: true,
    changed: false,
    cartBefore: input.cartBefore,
    previewState: { ...input.state, confirmedAt },
    confirmedPreview: preview,
    commercialEvaluation: commercial,
    ...(input.action ? { normalizedAction: input.action } : {}),
    nextStep: "CONFIRMED_ORDER_PREVIEW",
    warnings: [...commercial.warnings],
  });
}

/**
 * Pure delivery + confirmation checkout boundary. It is Preview-only by the
 * caller contract and never persists, sends, or creates a production order.
 */
export function runDeliveryConfirmationService(
  input: DeliveryConfirmationPreviewInput & { action?: DeliveryConfirmationAction },
): DeliveryConfirmationPreviewResult {
  const cartBefore = cloneDeliveryCart(input.cart || {
    schemaVersion: 1,
    mode: "STANDARD",
    status: "EMPTY",
    items: [],
    orderLevelFields: {},
  });
  const state = normalizeDeliveryPreviewState(input.previewState, cartBefore);
  const hasExplicitState = input.previewState !== undefined;
  const rawText = typeof input.deliveryConfirmationText === "string"
    ? input.deliveryConfirmationText
    : input.deliveryConfirmationText === undefined
      ? undefined
      : "";

  if (!state) {
    if (input.previewState !== undefined) {
      return createDeliveryConfirmationBlockedResult({ cartBefore, failureCode: "INVALID_DELIVERY_STATE" });
    }
    return startDeliveryCollection({ source: input, cartBefore });
  }

  // A resumed cart may render without state, but cannot consume customer input.
  if (!hasExplicitState && (rawText !== undefined || input.action)) {
    return createDeliveryConfirmationResult({ handled: false, success: false, changed: false, cartBefore, warnings: [] });
  }

  if (state.kind === "CONFIRMED_PREVIEW" || cartBefore.status === "CONFIRMED") {
    if (input.action?.type === "CONFIRM") {
      return renderConfirmedPreview({
        source: input,
        cartBefore,
        state: { ...state, kind: "CONFIRMED_PREVIEW" },
        action: input.action,
      });
    }
    return createDeliveryConfirmationBlockedResult({
      cartBefore,
      previewState: state,
      failureCode: "CONFIRMED_PREVIEW_LOCKED",
      action: input.action,
    });
  }

  if (state.kind === "COLLECTING_DELIVERY") {
    if (cartBefore.status !== "COLLECTING_DELIVERY") {
      return createDeliveryConfirmationBlockedResult({
        cartBefore,
        previewState: state,
        failureCode: "INVALID_DELIVERY_STATE",
        action: input.action,
      });
    }
    const lifecycleFailure = validateDeliveryCartLifecycle(input, cartBefore);
    if (lifecycleFailure) {
      return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: lifecycleFailure, action: input.action });
    }
    const requirements = getDeliveryRequirementsFor(input, cartBefore);
    const requirement = getCurrentDeliveryRequirement({ requirements, cart: cartBefore, productContext: input.productContext });
    if (!requirement) {
      return renderDeliveryFinalReview({ source: input, cartBefore, cart: cartBefore, requirements, state, changed: false, action: input.action });
    }
    const expectedFieldKey = state.currentFieldKey || requirement.key;
    if (normalizeDeliveryFieldKey(expectedFieldKey) !== normalizeDeliveryFieldKey(requirement.key)) {
      return createDeliveryConfirmationBlockedResult({
        cartBefore,
        previewState: state,
        failureCode: "FIELD_NOT_CURRENTLY_EXPECTED",
        action: input.action,
      });
    }
    if (input.action) {
      if (input.action.type === "CONFIRM") {
        return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "CONFIRMATION_NOT_READY", action: input.action });
      }
      if (input.action.type !== "SELECT_FIELD_VALUE" || normalizeDeliveryFieldKey(input.action.fieldKey) !== normalizeDeliveryFieldKey(requirement.key)) {
        return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "FIELD_NOT_CURRENTLY_EXPECTED", action: input.action });
      }
      return receiveDeliveryFieldValue({
        source: input,
        cartBefore,
        cart: cartBefore,
        state,
        requirement,
        rawValue: input.action.canonicalValue,
        action: input.action,
        editing: false,
      });
    }
    if (rawText === undefined) {
      return buildDeliveryCollectionResult({
        cartBefore,
        cartAfter: cartBefore,
        state,
        requirements,
        requiredFields: input.requiredFields,
        productContext: input.productContext,
        deliveryPricing: input.deliveryPricing,
        commercial: evaluateDeliveryCommercial(input, cartBefore),
        changed: false,
      });
    }
    return receiveDeliveryFieldValue({
      source: input,
      cartBefore,
      cart: cartBefore,
      state,
      requirement,
      rawValue: rawText,
      editing: false,
    });
  }

  if (state.kind === "EDITING_DELIVERY_FIELD") {
    if (cartBefore.status !== "AWAITING_CONFIRMATION") {
      return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "INVALID_DELIVERY_STATE", action: input.action });
    }
    const requirements = getDeliveryRequirementsFor(input, cartBefore);
    if (!state.editingFieldKey) {
      if (input.action?.type !== "SELECT_FIELD") {
        if (input.action?.type === "CANCEL_EDIT") {
          return renderDeliveryFinalReview({ source: input, cartBefore, cart: cartBefore, requirements, state, changed: false, action: input.action });
        }
        return createDeliveryConfirmationResult({
          handled: true,
          success: true,
          changed: false,
          cartBefore,
          previewState: state,
          presentation: buildDeliveryFieldSelectorPresentation(requirements),
          commercialEvaluation: evaluateDeliveryCommercial(input, cartBefore),
          nextStep: "EDIT_ORDER_FIELD",
          warnings: [],
        });
      }
      const field = findDeliveryRequirement(requirements, input.action.fieldKey);
      if (!field) return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "FIELD_NOT_CONFIGURED", action: input.action });
      const editState: DeliveryConfirmationPreviewState = {
        version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
        kind: "EDITING_DELIVERY_FIELD",
        editingFieldKey: field.key,
      };
      return createDeliveryConfirmationResult({
        handled: true,
        success: true,
        changed: false,
        cartBefore,
        previewState: editState,
        presentation: buildDeliveryFieldPresentation(field),
        commercialEvaluation: evaluateDeliveryCommercial(input, cartBefore),
        normalizedAction: input.action,
        nextStep: "EDIT_ORDER_FIELD",
        warnings: [],
      });
    }
    const field = findDeliveryRequirement(requirements, state.editingFieldKey);
    if (!field) return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "FIELD_NOT_CONFIGURED", action: input.action });
    if (input.action?.type === "CANCEL_EDIT") {
      return renderDeliveryFinalReview({ source: input, cartBefore, cart: cartBefore, requirements, state, changed: false, action: input.action });
    }
    if (input.action) {
      if (input.action.type !== "SELECT_FIELD_VALUE" || normalizeDeliveryFieldKey(input.action.fieldKey) !== normalizeDeliveryFieldKey(field.key)) {
        return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "FIELD_NOT_CURRENTLY_EXPECTED", action: input.action });
      }
      return receiveDeliveryFieldValue({
        source: input,
        cartBefore,
        cart: cartBefore,
        state,
        requirement: field,
        rawValue: input.action.canonicalValue,
        action: input.action,
        editing: true,
      });
    }
    if (rawText === undefined) {
      return createDeliveryConfirmationResult({
        handled: true,
        success: true,
        changed: false,
        cartBefore,
        previewState: state,
        presentation: buildDeliveryFieldPresentation(field),
        commercialEvaluation: evaluateDeliveryCommercial(input, cartBefore),
        nextStep: "EDIT_ORDER_FIELD",
        warnings: [],
      });
    }
    return receiveDeliveryFieldValue({
      source: input,
      cartBefore,
      cart: cartBefore,
      state,
      requirement: field,
      rawValue: rawText,
      editing: true,
    });
  }

  if (cartBefore.status !== "AWAITING_CONFIRMATION") {
    return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "INVALID_DELIVERY_STATE", action: input.action });
  }
  const requirements = getDeliveryRequirementsFor(input, cartBefore);
  if (!input.action) {
    if (rawText !== undefined) return createDeliveryConfirmationResult({ handled: false, success: false, changed: false, cartBefore, previewState: state, warnings: [] });
    return renderDeliveryFinalReview({ source: input, cartBefore, cart: cartBefore, requirements, state, changed: false });
  }
  if (input.action.type === "EDIT_DELIVERY") {
    const editState: DeliveryConfirmationPreviewState = {
      version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
      kind: "EDITING_DELIVERY_FIELD",
    };
    return createDeliveryConfirmationResult({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      previewState: editState,
      presentation: buildDeliveryFieldSelectorPresentation(requirements),
      commercialEvaluation: evaluateDeliveryCommercial(input, cartBefore),
      normalizedAction: input.action,
      nextStep: "EDIT_ORDER_FIELD",
      warnings: [],
    });
  }
  if (input.action.type === "BACK_TO_CART") {
    const lifecycle = setCartStatus({ cart: cartBefore, status: "CART_REVIEW" });
    if (!lifecycle.accepted) return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "CART_MUTATION_REJECTED", action: input.action });
    const commercial = evaluateDeliveryCommercial(input, lifecycle.cart);
    const commercialFailureCode = getDeliveryCommercialFailure(commercial);
    return createDeliveryConfirmationResult({
      handled: true,
      success: !commercialFailureCode,
      changed: lifecycle.cart.status !== cartBefore.status,
      cartBefore,
      cartAfter: lifecycle.cart,
      ...(commercialFailureCode
        ? { presentation: buildCommercialResolutionPresentation(), failureCode: commercialFailureCode, nextStep: "RESOLVE_COMMERCIAL_STATE" as const }
        : { nextStep: "RETURN_TO_CART_REVIEW" as const }),
      commercialEvaluation: commercial,
      normalizedAction: input.action,
      warnings: [...commercial.warnings],
    });
  }
  if (input.action.type !== "CONFIRM") {
    return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "CONFIRMATION_NOT_READY", action: input.action });
  }
  const lifecycleFailure = validateDeliveryCartLifecycle(input, cartBefore);
  if (lifecycleFailure) return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: lifecycleFailure, action: input.action });
  const missing = getCurrentDeliveryRequirement({ requirements, cart: cartBefore, productContext: input.productContext });
  if (missing) {
    return createDeliveryConfirmationResult({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      previewState: { version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION, kind: "COLLECTING_DELIVERY", currentFieldKey: missing.key },
      presentation: buildDeliveryFieldPresentation(missing),
      normalizedAction: input.action,
      nextStep: "COLLECT_ORDER_FIELD",
      failureCode: "CONFIRMATION_NOT_READY",
      warnings: [],
    });
  }
  const commercial = evaluateDeliveryCommercial(input, cartBefore);
  const commercialFailureCode = getDeliveryCommercialFailure(commercial);
  if (commercialFailureCode) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore,
      previewState: state,
      failureCode: commercialFailureCode,
      commercial,
      action: input.action,
      resolveCommercial: true,
      warnings: [...commercial.warnings],
    });
  }
  const finalReview = buildFinalOrderReview({
    cart: cartBefore,
    requirements,
    requiredFields: input.requiredFields,
    productContext: input.productContext,
    commercial,
    deliveryPricing: input.deliveryPricing,
  });
  if (!finalReview) {
    return createDeliveryConfirmationBlockedResult({
      cartBefore,
      previewState: state,
      failureCode: "COMMERCIAL_STATE_BLOCKED",
      commercial,
      action: input.action,
      resolveCommercial: true,
    });
  }
  const lifecycle = setCartStatus({ cart: cartBefore, status: "CONFIRMED" });
  if (!lifecycle.accepted) return createDeliveryConfirmationBlockedResult({ cartBefore, previewState: state, failureCode: "CART_MUTATION_REJECTED", action: input.action });
  const confirmedAt = Number.isNaN(input.now.getTime()) ? "" : input.now.toISOString();
  const confirmedState: DeliveryConfirmationPreviewState = {
    version: DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION,
    kind: "CONFIRMED_PREVIEW",
    confirmedAt,
  };
  const confirmedPreview = buildConfirmedOrderPreview({
    finalReview,
    sellerId: input.sellerId,
    conversationScopeId: input.conversationScopeId,
    confirmedAt,
  });
  return createDeliveryConfirmationResult({
    handled: true,
    success: true,
    changed: true,
    cartBefore,
    cartAfter: lifecycle.cart,
    previewState: confirmedState,
    confirmedPreview,
    commercialEvaluation: commercial,
    normalizedAction: input.action,
    nextStep: "CONFIRMED_ORDER_PREVIEW",
    warnings: [...commercial.warnings],
  });
}
