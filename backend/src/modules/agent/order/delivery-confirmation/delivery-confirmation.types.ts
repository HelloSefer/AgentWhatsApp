import type { ProductOfferLookupResult } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import type {
  AgentReplyUiHint,
  OrderConfirmationPresentation,
} from "../../reply/reply-renderer.types";
import type { DeliveryPricingConfig } from "../../config/seller-config.types";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import type { CartItemEditPreviewState } from "../cart-review/item-edit/cart-item-edit.types";
import type { CartReviewPreviewState } from "../cart-review/cart-review.types";

export const DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION = 1 as const;

export type DeliveryConfirmationPreviewKind =
  | "COLLECTING_DELIVERY"
  | "FINAL_ORDER_REVIEW"
  | "EDITING_DELIVERY_FIELD"
  | "CONFIRMED_PREVIEW";

/** Detached UI state only. Cart values remain authoritative in orderLevelFields. */
export type DeliveryConfirmationPreviewState = Readonly<{
  version: typeof DELIVERY_CONFIRMATION_PREVIEW_STATE_VERSION;
  kind: DeliveryConfirmationPreviewKind;
  currentFieldKey?: string;
  editingFieldKey?: string;
  attempts?: number;
  confirmedAt?: string;
}>;

export type DeliveryConfirmationAction =
  | { type: "CONFIRM"; rawId: "order_checkout:confirm" }
  | { type: "EDIT_DELIVERY"; rawId: "order_checkout:edit_delivery" }
  | { type: "BACK_TO_CART"; rawId: "order_checkout:back_to_cart" }
  | { type: "CANCEL_EDIT"; rawId: "order_checkout:cancel_edit" }
  | { type: "SELECT_FIELD"; rawId: string; fieldKey: string }
  | { type: "SELECT_FIELD_VALUE"; rawId: string; fieldKey: string; canonicalValue: string };

export type DeliveryConfirmationActionNormalizationResult = {
  recognized: boolean;
  valid: boolean;
  action?: DeliveryConfirmationAction;
  failureCode?:
    | "NOT_DELIVERY_CONFIRMATION_ACTION"
    | "ACTION_ID_TOO_LONG"
    | "MALFORMED_ACTION_ID"
    | "EXTRA_ACTION_SEGMENT"
    | "UNSAFE_FIELD_KEY"
    | "UNSAFE_CANONICAL_VALUE";
};

export type DeliveryRequirement = Readonly<{
  key: string;
  label: string;
  prompt?: string;
  required: boolean;
  captureMode?: RequiredOrderField["captureMode"];
  semanticType?: string;
  options?: readonly string[];
  field: RequiredOrderField;
}>;

export type DeliveryFieldValueNormalizationResult =
  | { valid: true; value: SupportedOrderFieldValue }
  | {
      valid: false;
      failureCode:
        | "INVALID_FIELD_VALUE"
        | "FIELD_VALUE_TOO_LONG"
        | "FIELD_VALUE_HAS_CONTROL_CHARACTERS"
        | "FIELD_VALUE_NOT_TEXT"
        | "FIELD_VALUE_NOT_CONFIGURED";
    };

export type DeliveryOrderFieldSnapshot = Readonly<{
  key: string;
  label: string;
  value: SupportedOrderFieldValue;
}>;

export type DeliveryReviewItemSnapshot = Readonly<{
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  options: readonly Readonly<{ key: string; label: string; value: SupportedOrderFieldValue }>[];
  unitPriceMinor: number;
  lineTotalMinor: number;
  unitPrice: number;
  lineTotal: number;
}>;

export type DeliveryFeeSnapshot = Readonly<{
  type: "FREE" | "PAID";
  amountMinor: number;
  amount: number;
  currency: string;
}>;

export type FinalOrderReview = Readonly<{
  items: readonly DeliveryReviewItemSnapshot[];
  completedUnits: number;
  targetUnits: number;
  orderFields: readonly DeliveryOrderFieldSnapshot[];
  standardSubtotalMinor: number;
  standardSubtotal: number;
  currency: string;
  selectedOffer?: Readonly<{
    offerId: string;
    label?: string;
    totalMinor: number;
    total: number;
    discountMinor: number;
    discountAmount: number;
  }>;
  recommendedOffer?: Readonly<{ offerId: string; label?: string; total: number }>;
  merchandiseTotalMinor: number;
  merchandiseTotal: number;
  deliveryFee?: DeliveryFeeSnapshot;
  finalTotalMinor: number;
  finalTotal: number;
  warnings: readonly string[];
  confirmationReady: boolean;
}>;

export type ConfirmedOrderPreview = Readonly<{
  sellerId: string;
  conversationScopeId: string;
  items: readonly DeliveryReviewItemSnapshot[];
  completedUnits: number;
  orderFields: readonly DeliveryOrderFieldSnapshot[];
  standardSubtotalMinor: number;
  standardSubtotal: number;
  currency: string;
  selectedOffer?: FinalOrderReview["selectedOffer"];
  merchandiseTotalMinor: number;
  merchandiseTotal: number;
  deliveryFee?: DeliveryFeeSnapshot;
  finalTotalMinor: number;
  finalTotal: number;
  confirmedAt: string;
}>;

export type DeliveryConfirmationPresentationKind =
  | "COLLECT_FIELD"
  | "FIELD_OPTIONS"
  | "FINAL_ORDER_REVIEW"
  | "EDIT_FIELD_SELECTOR"
  | "BLOCKED";

export type DeliveryConfirmationPresentation = Readonly<{
  kind: DeliveryConfirmationPresentationKind;
  promptKey:
    | "COLLECT_ORDER_FIELD"
    | "FINAL_ORDER_REVIEW"
    | "EDIT_ORDER_FIELD"
    | "RESOLVE_COMMERCIAL_STATE"
    | "BLOCKED";
  text?: string;
  field?: Readonly<{ key: string; label: string }>;
  uiHints?: AgentReplyUiHint;
  orderConfirmationPresentation?: OrderConfirmationPresentation;
}>;

export type DeliveryConfirmationNextStep =
  | "COLLECT_ORDER_FIELD"
  | "FINAL_ORDER_REVIEW"
  | "EDIT_ORDER_FIELD"
  | "RETURN_TO_CART_REVIEW"
  | "RESOLVE_COMMERCIAL_STATE"
  | "CONFIRMED_ORDER_PREVIEW"
  | "BLOCKED";

export type DeliveryConfirmationFailureCode =
  | "PREVIEW_STATE_REQUIRED"
  | "INVALID_DELIVERY_STATE"
  | "CONFLICTING_CART_REVIEW_STATE"
  | "CONFLICTING_ITEM_EDIT_STATE"
  | "INVALID_CART"
  | "PRODUCT_MISMATCH"
  | "INVALID_CONVERSATION_SCOPE"
  | "CART_NOT_READY_FOR_DELIVERY"
  | "CURRENT_ITEM_PRESENT"
  | "TARGET_NOT_FULFILLED"
  | "TARGET_OVERFILLED"
  | "EMPTY_CART"
  | "SELECTED_OFFER_INELIGIBLE"
  | "COMMERCIAL_STATE_BLOCKED"
  | "FIELD_NOT_CURRENTLY_EXPECTED"
  | "FIELD_NOT_CONFIGURED"
  | "ORDER_SCOPED_FIELD_REQUIRED"
  | "OPEN_TEXT_ACTION_NOT_SUPPORTED"
  | "TEXT_FIELD_NOT_AWAITED"
  | "INVALID_FIELD_VALUE"
  | "CART_MUTATION_REJECTED"
  | "CONFIRMATION_NOT_READY"
  | "CONFIRMED_PREVIEW_LOCKED";

export type DeliveryConfirmationPreviewInput = {
  previewEnabled: boolean;
  rawActionId?: unknown;
  deliveryConfirmationText?: unknown;
  previewState?: DeliveryConfirmationPreviewState;
  cart?: CartDraft;
  sellerId: string;
  conversationScopeId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  offerLookup: ProductOfferLookupResult;
  deliveryPricing?: DeliveryPricingConfig;
  now: Date;
  includeOptionalFieldKeys?: readonly string[];
  cartReviewPreviewState?: CartReviewPreviewState;
  cartItemEditPreviewState?: CartItemEditPreviewState;
};

export type DeliveryConfirmationPreviewResult = {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  previewState?: DeliveryConfirmationPreviewState;
  presentation?: DeliveryConfirmationPresentation;
  finalReview?: FinalOrderReview;
  confirmedPreview?: ConfirmedOrderPreview;
  commercialEvaluation?: CartCommercialEvaluation;
  normalizedAction?: DeliveryConfirmationAction;
  nextStep?: DeliveryConfirmationNextStep;
  failureCode?: DeliveryConfirmationFailureCode | DeliveryConfirmationActionNormalizationResult["failureCode"];
  warnings: string[];
};
