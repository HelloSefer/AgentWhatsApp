import type { ConfirmedOrderSnapshot, ConfirmedOrderSnapshotItem } from "../../confirmed-order/confirmed-order-snapshot.types";

export type PersistedConfirmedOrder = Readonly<{
  sellerId: string;
  orderId: string;
  customerPhone: string;
  status: "CONFIRMED";
  currencyCode: string;
  subtotalAmountMinor: number;
  deliveryAmountMinor: number;
  totalAmountMinor: number;
  deliveryDetails: Readonly<Record<string, string | number | boolean>>;
  confirmationIdempotencyKey: string;
  confirmationPayloadHash: string;
  createdAt: Date;
  confirmedAt: Date;
  items: readonly ConfirmedOrderSnapshotItem[];
  snapshot: ConfirmedOrderSnapshot;
}>;

export type ConfirmedOrderSummary = Readonly<{
  orderId: string;
  customerPhone: string;
  currencyCode: string;
  totalAmountMinor: number;
  confirmedAt: Date;
}>;

export type ConfirmedOrderList = Readonly<{ orders: readonly ConfirmedOrderSummary[]; nextCursor?: string }>;
