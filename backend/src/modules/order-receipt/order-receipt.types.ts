import type { ConfirmedOrder } from "../agent/order/confirmed-order-store.service";

export type ReceiptSendStatus =
  | "NOT_REQUESTED"
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export interface OrderReceiptRecord {
  orderId: string;
  pdfPath?: string;
  mediaId?: string;
  sentAt?: string;
  sendStatus: ReceiptSendStatus;
  lastError?: string;
  errorCode?: "RECEIPT_DATA_INVALID";
  invalidFields?: string[];
  localFileDeleted?: boolean;
  localFileDeletedAt?: string;
  localFileDeleteError?: string;
}

export type OrderReceiptOrder = ConfirmedOrder;
