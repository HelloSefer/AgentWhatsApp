import type { ConfirmedOrderSnapshot } from "./confirmed-order-snapshot.types";
import type { ConfirmedOrderSnapshotInput } from "./confirmed-order-snapshot.types";
import type {
  PremiumOrderReceiptViewModel,
  PremiumReceiptCustomerField,
  PremiumReceiptItem,
} from "../../../order-receipt/premium-order-receipt.types";

export const CONFIRMED_ORDER_RECEIPT_MODEL_VERSION = 1 as const;

export type ConfirmedOrderReceiptLine = PremiumReceiptItem;

export type ConfirmedOrderReceiptField = PremiumReceiptCustomerField;

export type ConfirmedOrderReceiptModel = PremiumOrderReceiptViewModel;

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

export type ConfirmedOrderReceiptPreparationResult = Readonly<{
  success: boolean;
  snapshot?: ConfirmedOrderSnapshot;
  receiptModel?: ConfirmedOrderReceiptModel;
  receiptDocument?: SafeReceiptDocumentMetadata;
  buffer?: Buffer;
  failureCode?: string;
  warnings: readonly string[];
}>;

export type ConfirmedOrderReceiptPreviewInput = ConfirmedOrderSnapshotInput;
