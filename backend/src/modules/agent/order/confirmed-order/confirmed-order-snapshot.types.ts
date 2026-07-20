import type { ProductOfferLookupResult } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import type { DeliveryPricingConfig } from "../../config/seller-config.types";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import type {
  ConfirmedOrderPreview,
  DeliveryFeeSnapshot,
  DeliveryConfirmationPreviewState,
} from "../delivery-confirmation/delivery-confirmation.types";

export const CONFIRMED_ORDER_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type ConfirmedOrderReceiptContext = Readonly<{
  storeName: string;
  paymentMethodLabel?: string;
  deliveryText?: string;
}>;

export type ConfirmedOrderSnapshotOption = Readonly<{
  key: string;
  label: string;
  value: SupportedOrderFieldValue;
}>;

export type ConfirmedOrderSnapshotItem = Readonly<{
  itemId: string;
  productId: string;
  productName: string;
  quantity: number;
  selectedOptions: readonly ConfirmedOrderSnapshotOption[];
  unitPriceMinor: number;
  lineTotalMinor: number;
  unitPrice: number;
  lineTotal: number;
}>;

export type ConfirmedOrderSnapshotField = Readonly<{
  key: string;
  label: string;
  value: SupportedOrderFieldValue;
}>;

export type ConfirmedOrderSelectedOfferSnapshot = Readonly<{
  offerId: string;
  label?: string;
  offerTotalMinor: number;
  discountMinor: number;
  offerTotal: number;
  discountAmount: number;
}>;

export type ConfirmedOrderRecommendedOfferSnapshot = Readonly<{
  offerId: string;
  label?: string;
  totalMinor: number;
  total: number;
}>;

export type ConfirmedOrderSnapshot = Readonly<{
  schemaVersion: typeof CONFIRMED_ORDER_SNAPSHOT_SCHEMA_VERSION;
  id: string;
  sellerId: string;
  conversationScopeId: string;
  confirmedAt: string;
  product: Readonly<{
    productId: string;
    name: string;
  }>;
  receiptContext: ConfirmedOrderReceiptContext;
  items: readonly ConfirmedOrderSnapshotItem[];
  completedUnits: number;
  targetUnits: number;
  orderFields: readonly ConfirmedOrderSnapshotField[];
  currency: string;
  standardSubtotalMinor: number;
  standardSubtotal: number;
  selectedOffer?: ConfirmedOrderSelectedOfferSnapshot;
  recommendedOffer?: ConfirmedOrderRecommendedOfferSnapshot;
  merchandiseTotalMinor: number;
  merchandiseTotal: number;
  deliveryFee?: DeliveryFeeSnapshot;
  finalTotalMinor: number;
  finalTotal: number;
  commercialWarnings: readonly string[];
}>;

export type ConfirmedOrderSnapshotFailureCode =
  | "PREVIEW_STATE_REQUIRED"
  | "CONFIRMED_PREVIEW_REQUIRED"
  | "INVALID_CONFIRMED_PREVIEW"
  | "PRODUCT_MISMATCH"
  | "INVALID_CONVERSATION_SCOPE"
  | "INVALID_CART"
  | "CURRENT_ITEM_PRESENT"
  | "EMPTY_CART"
  | "TARGET_NOT_FULFILLED"
  | "TARGET_OVERFILLED"
  | "REQUIRED_ORDER_FIELD_MISSING"
  | "INVALID_ORDER_FIELD"
  | "INVALID_ITEM_OPTION"
  | "SELECTED_OFFER_INELIGIBLE"
  | "COMMERCIAL_STATE_BLOCKED"
  | "INVALID_SNAPSHOT_ID"
  | "INVALID_CONFIRMED_AT"
  | "UNSAFE_MONEY_VALUE"
  | "SNAPSHOT_VALIDATION_FAILED";

export type ConfirmedOrderSnapshotInput = Readonly<{
  previewEnabled: boolean;
  cart?: CartDraft;
  previewState?: DeliveryConfirmationPreviewState;
  confirmedPreview?: ConfirmedOrderPreview;
  sellerId: string;
  conversationScopeId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  deliveryPricing?: DeliveryPricingConfig;
  offerLookup: ProductOfferLookupResult;
  receiptContext: ConfirmedOrderReceiptContext;
  now: Date;
  snapshotId?: unknown;
  confirmedAt?: unknown;
  snapshotIdFactory?: () => string;
  confirmedAtFactory?: () => string;
}>;

export type ConfirmedOrderSnapshotResult = Readonly<{
  success: boolean;
  snapshot?: ConfirmedOrderSnapshot;
  commercialEvaluation?: CartCommercialEvaluation;
  failureCode?: ConfirmedOrderSnapshotFailureCode;
  warnings: readonly string[];
}>;
