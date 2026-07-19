import type { AgentReplyUiHint } from "../../reply/reply-renderer.types";
import type { CartDraft } from "../cart-state.types";
import type { CartPlanningPreviewState } from "../planning/quantity/flow/cart-custom-quantity-flow.types";
import type { SameAsPreviousPreviewState } from "../item-collection/shortcuts/same-as-previous.types";
import type { CartReviewPreviewState } from "../cart-review/cart-review.types";
import type { CartItemEditPreviewState } from "../cart-review/item-edit/cart-item-edit.types";
import type { DeliveryConfirmationPreviewState } from "../delivery-confirmation/delivery-confirmation.types";
import type { SafeReceiptDocumentMetadata } from "../confirmed-order/confirmed-order-receipt.types";

export const ORDER_RUNTIME_SESSION_VERSION = 1 as const;

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
  runtimeStage: OrderRuntimeStage;
  planningState?: CartPlanningPreviewState;
  itemCollectionState?: SameAsPreviousPreviewState;
  cartReviewState?: CartReviewPreviewState;
  itemEditState?: CartItemEditPreviewState;
  deliveryConfirmationState?: DeliveryConfirmationPreviewState;
  lastHandledAction?: string;
  confirmed?: {
    snapshotId: string;
    status: "CONFIRMED";
    receipt: SafeReceiptDocumentMetadata;
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
  /** Explicit API/test activation; production transport never sets this. */
  activationRequested?: boolean;
};

export type OrderRuntimeTurnResult = {
  handled: boolean;
  reply?: string;
  replyUi?: AgentReplyUiHint;
  stage?: OrderRuntimeStage;
  warnings: string[];
  failureCode?: string;
  confirmedSnapshotId?: string;
  receiptReady?: boolean;
};
