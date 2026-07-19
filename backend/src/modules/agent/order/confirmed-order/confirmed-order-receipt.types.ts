import type { ConfirmedOrderSnapshot } from "./confirmed-order-snapshot.types";
import type { ConfirmedOrderSnapshotInput } from "./confirmed-order-snapshot.types";

export const CONFIRMED_ORDER_RECEIPT_MODEL_VERSION = 1 as const;

export type ConfirmedOrderReceiptLine = Readonly<{
  productName: string;
  quantity: number;
  options: readonly Readonly<{ label: string; value: string }>[];
  unitPrice: number;
  lineTotal: number;
}>;

export type ConfirmedOrderReceiptField = Readonly<{
  label: string;
  value: string;
}>;

export type ConfirmedOrderReceiptModel = Readonly<{
  schemaVersion: typeof CONFIRMED_ORDER_RECEIPT_MODEL_VERSION;
  referenceId: string;
  storeName: string;
  confirmedAt: string;
  statusLabel: string;
  lines: readonly ConfirmedOrderReceiptLine[];
  deliveryFields: readonly ConfirmedOrderReceiptField[];
  currency: string;
  standardSubtotal: number;
  selectedOffer?: Readonly<{
    label: string;
    discountAmount: number;
    total: number;
  }>;
  finalTotal: number;
  paymentMethodLabel?: string;
  deliveryText?: string;
}>;

export type SafeReceiptDocumentMetadata = Readonly<{
  filename: string;
  mimeType: "application/pdf";
  byteLength: number;
  checksum: string;
}>;

export type ReceiptDocumentResult = Readonly<{
  success: boolean;
  filename?: string;
  mimeType?: "application/pdf";
  byteLength?: number;
  checksum?: string;
  buffer?: Buffer;
  failureCode?: "PDF_GENERATION_FAILED" | "INVALID_RECEIPT_MODEL";
  warnings: readonly string[];
}>;

export type ConfirmedOrderReceiptBuildResult = Readonly<{
  success: boolean;
  receiptModel?: ConfirmedOrderReceiptModel;
  failureCode?: "INVALID_SNAPSHOT";
  warnings: readonly string[];
}>;

export type ConfirmedOrderReceiptPreviewResult = Readonly<{
  handled: boolean;
  success: boolean;
  previewOnly: true;
  dryRun: true;
  snapshot?: ConfirmedOrderSnapshot;
  receiptModel?: ConfirmedOrderReceiptModel;
  receiptDocument?: SafeReceiptDocumentMetadata;
  nextStep?: "RECEIPT_PREVIEW_READY" | "BLOCKED";
  failureCode?: string;
  warnings: readonly string[];
}>;

export type ConfirmedOrderReceiptPreviewInput = ConfirmedOrderSnapshotInput;
