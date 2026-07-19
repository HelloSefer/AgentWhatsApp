import {
  buildBlockedDeliveryPresentation,
  buildCommercialResolutionPresentation,
} from "./delivery-confirmation-presentation.service";
import {
  cloneConfirmedOrderPreview,
  cloneDeliveryCart,
  cloneDeliveryCommercialEvaluation,
  cloneDeliveryPreviewState,
  cloneFinalOrderReview,
} from "./delivery-confirmation-snapshot.service";
import type {
  DeliveryConfirmationAction,
  DeliveryConfirmationActionNormalizationResult,
  DeliveryConfirmationFailureCode,
  DeliveryConfirmationPreviewResult,
  DeliveryConfirmationPreviewState,
  FinalOrderReview,
  ConfirmedOrderPreview,
} from "./delivery-confirmation.types";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartDraft } from "../cart-state.types";

export function createDeliveryConfirmationResult(input: {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  previewState?: DeliveryConfirmationPreviewState;
  presentation?: DeliveryConfirmationPreviewResult["presentation"];
  finalReview?: FinalOrderReview;
  confirmedPreview?: ConfirmedOrderPreview;
  commercialEvaluation?: CartCommercialEvaluation;
  normalizedAction?: DeliveryConfirmationAction;
  nextStep?: DeliveryConfirmationPreviewResult["nextStep"];
  failureCode?: DeliveryConfirmationPreviewResult["failureCode"];
  warnings?: string[];
}): DeliveryConfirmationPreviewResult {
  return {
    handled: input.handled,
    success: input.success,
    changed: input.changed,
    cartBefore: cloneDeliveryCart(input.cartBefore),
    cartAfter: cloneDeliveryCart(input.cartAfter || input.cartBefore),
    ...(input.previewState ? { previewState: cloneDeliveryPreviewState(input.previewState) } : {}),
    ...(input.presentation ? { presentation: { ...input.presentation, ...(input.presentation.field ? { field: { ...input.presentation.field } } : {}), ...(input.presentation.uiHints ? { uiHints: { ...input.presentation.uiHints, options: input.presentation.uiHints.options?.map((option) => ({ ...option })) } } : {}) } } : {}),
    ...(input.finalReview ? { finalReview: cloneFinalOrderReview(input.finalReview) } : {}),
    ...(input.confirmedPreview ? { confirmedPreview: cloneConfirmedOrderPreview(input.confirmedPreview) } : {}),
    ...(input.commercialEvaluation ? { commercialEvaluation: cloneDeliveryCommercialEvaluation(input.commercialEvaluation) } : {}),
    ...(input.normalizedAction ? { normalizedAction: { ...input.normalizedAction } } : {}),
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    warnings: [...(input.warnings || [])],
  };
}

export function createDeliveryConfirmationBlockedResult(input: {
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  previewState?: DeliveryConfirmationPreviewState;
  failureCode: DeliveryConfirmationFailureCode | DeliveryConfirmationActionNormalizationResult["failureCode"];
  commercial?: CartCommercialEvaluation;
  action?: DeliveryConfirmationAction;
  resolveCommercial?: boolean;
  warnings?: string[];
}): DeliveryConfirmationPreviewResult {
  return createDeliveryConfirmationResult({
    handled: true,
    success: false,
    changed: false,
    cartBefore: input.cartBefore,
    ...(input.cartAfter ? { cartAfter: input.cartAfter } : {}),
    previewState: input.previewState,
    presentation: input.resolveCommercial ? buildCommercialResolutionPresentation() : buildBlockedDeliveryPresentation(),
    ...(input.commercial ? { commercialEvaluation: input.commercial } : {}),
    ...(input.action ? { normalizedAction: input.action } : {}),
    nextStep: input.resolveCommercial ? "RESOLVE_COMMERCIAL_STATE" : "BLOCKED",
    failureCode: input.failureCode,
    warnings: input.warnings,
  });
}
