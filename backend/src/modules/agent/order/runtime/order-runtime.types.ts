import type {
  AgentReplyUiHint,
  OrderConfirmationPresentation,
} from "../../reply/reply-renderer.types";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import type { CartPlanningPreviewState } from "../planning/quantity/flow/cart-custom-quantity-flow.types";
import type { SameAsPreviousPreviewState } from "../item-collection/shortcuts/same-as-previous.types";
import type { CartReviewPreviewState } from "../cart-review/cart-review.types";
import type { CartItemEditPreviewState } from "../cart-review/item-edit/cart-item-edit.types";
import type { DeliveryConfirmationPreviewState } from "../delivery-confirmation/delivery-confirmation.types";
import type { SafeReceiptDocumentMetadata } from "../confirmed-order/confirmed-order-receipt.types";

export const ORDER_RUNTIME_SESSION_VERSION = 1 as const;

export type OrderRuntimeReceiptDispatchStatus =
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export type OrderRuntimeReceiptState = SafeReceiptDocumentMetadata & {
  dispatchStatus: OrderRuntimeReceiptDispatchStatus;
  sentAt?: string;
  failedAt?: string;
  skippedAt?: string;
  cloudMessageIdMasked?: string;
  failureCode?: string;
  failureMessage?: string;
};

export type OrderRuntimeReceiptArtifact = {
  snapshotId: string;
  publicOrderCode: string;
  document: SafeReceiptDocumentMetadata;
  buffer: Buffer;
  runtimeIdentity: {
    sellerId: string;
    customerPhone: string;
    conversationKey: string;
    productId: string;
  };
};

export type OrderRuntimeStage =
  | "FIRST_ENTRY"
  | "PLANNING"
  | "COLLECTING_ITEM"
  | "CART_REVIEW"
  | "EDITING_CART_ITEM"
  | "COLLECTING_DELIVERY"
  | "FINAL_ORDER_REVIEW"
  | "CONFIRMED"
  | "RECOVERY_REQUIRED";

export type OrderRuntimeSession = {
  version: typeof ORDER_RUNTIME_SESSION_VERSION;
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  productId: string;
  cart: CartDraft;
  /** Soft information preferences, transferred only after explicit Order Now. */
  pendingInitialItemOptions?: Record<string, SupportedOrderFieldValue>;
  /** First configured option collected before physical-piece planning. */
  orderEntryFieldKey?: string;
  runtimeStage: OrderRuntimeStage;
  planningState?: CartPlanningPreviewState;
  itemCollectionState?: SameAsPreviousPreviewState;
  cartReviewState?: CartReviewPreviewState;
  itemEditState?: CartItemEditPreviewState;
  deliveryConfirmationState?: DeliveryConfirmationPreviewState;
  /** Retains the authoritative confirmation identity across a guarded write retry. */
  pendingConfirmation?: {
    publicOrderCode: string;
    confirmedAt: string;
  };
  lastHandledAction?: string;
  confirmed?: {
    snapshotId: string;
    publicOrderCode: string;
    status: "CONFIRMED";
    receipt: OrderRuntimeReceiptState;
    confirmedAt: string;
  };
  updatedAt: string;
};

export type OrderRuntimeReadiness = {
  flowEnabled: boolean;
  runtimeMode: "disabled" | "dry_run" | "guarded";
  liveDispatchEnabled: boolean;
  guardedSellerScope: boolean;
  sellerKnown: boolean;
  valkeyReady: boolean;
  reason?: string;
};

export type OrderRuntimeTurnInput = {
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  productId?: string;
  message: string;
  actionId?: string;
  normalizedText?: string;
  sourceType?: import("../../agent-action.types").AgentInboundSourceType;
  /** Explicit activation after API-test or trusted transport scope validation. */
  activationRequested?: boolean;
};

export type OrderRuntimeTurnResult = {
  handled: boolean;
  reply?: string;
  replyUi?: AgentReplyUiHint;
  orderConfirmationPresentation?: OrderConfirmationPresentation;
  stage?: OrderRuntimeStage;
  warnings: string[];
  failureCode?: string;
  confirmedSnapshotId?: string;
  receiptReady?: boolean;
  publicOrderCode?: string;
  receiptArtifact?: OrderRuntimeReceiptArtifact;
};
