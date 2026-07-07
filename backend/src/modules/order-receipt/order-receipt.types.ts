import type { ConfirmedOrder } from "../agent/order/confirmed-order-store.service";

export type ReceiptSendStatus = "SENT" | "FAILED" | "SKIPPED";

export interface OrderReceiptRecord {
  orderId: string;
  pdfPath?: string;
  mediaId?: string;
  sentAt?: string;
  sendStatus: ReceiptSendStatus;
  lastError?: string;
}

export type OrderReceiptOrder = ConfirmedOrder;

