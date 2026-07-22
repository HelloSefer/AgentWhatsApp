import { buildConfirmedOrderReceiptModel } from "../../../confirmed-order/confirmed-order-receipt.service";
import type { ConfirmedOrderSnapshot, ConfirmedOrderSnapshotItem } from "../../../confirmed-order/confirmed-order-snapshot.types";
import { ConfirmedOrderCorruptedError } from "../../domain/order-persistence.errors";
import type { PersistedConfirmedOrder } from "../../domain/confirmed-order-persistence.types";

export type OrderRow = Readonly<{ seller_id: string; order_id: string; customer_phone: string; order_status: string; currency_code: string; subtotal_amount_minor: string | number; delivery_amount_minor: string | number; total_amount_minor: string | number; delivery_details_json: unknown; confirmation_idempotency_key: string; confirmation_payload_hash: string; created_at: Date | string; confirmed_at: Date | string }>;
export type SnapshotRow = Readonly<{ snapshot_json: unknown }>;

function freeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const child of Object.values(value as Record<string, unknown>)) freeze(child); return Object.freeze(value); }
function json(value: unknown): unknown { if (typeof value === "string") { try { return JSON.parse(value); } catch { throw new ConfirmedOrderCorruptedError(); } } return value; }
function integer(value: string | number): number { const result = typeof value === "number" ? value : Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new ConfirmedOrderCorruptedError(); return result; }
function date(value: Date | string): Date { const result = new Date(value); if (Number.isNaN(result.getTime())) throw new ConfirmedOrderCorruptedError(); return result; }

export function mapConfirmedOrderSnapshot(row: SnapshotRow): ConfirmedOrderSnapshot {
  const snapshot = json(row.snapshot_json);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !(snapshot as { schemaVersion?: unknown }).schemaVersion) throw new ConfirmedOrderCorruptedError();
  if (!buildConfirmedOrderReceiptModel(snapshot as ConfirmedOrderSnapshot).success) throw new ConfirmedOrderCorruptedError();
  return freeze(snapshot as ConfirmedOrderSnapshot);
}

export function mapPersistedConfirmedOrder(root: OrderRow, snapshotRow: SnapshotRow): PersistedConfirmedOrder {
  const snapshot = mapConfirmedOrderSnapshot(snapshotRow);
  const details = json(root.delivery_details_json);
  if (!details || typeof details !== "object" || Array.isArray(details) || root.order_status !== "CONFIRMED" || snapshot.id !== root.order_id || snapshot.sellerId !== root.seller_id) throw new ConfirmedOrderCorruptedError();
  const subtotalAmountMinor = integer(root.subtotal_amount_minor);
  const deliveryAmountMinor = integer(root.delivery_amount_minor);
  const totalAmountMinor = integer(root.total_amount_minor);
  if (totalAmountMinor !== subtotalAmountMinor + deliveryAmountMinor || snapshot.finalTotalMinor !== totalAmountMinor) throw new ConfirmedOrderCorruptedError();
  return freeze({ sellerId: root.seller_id, orderId: root.order_id, customerPhone: root.customer_phone, status: "CONFIRMED", currencyCode: root.currency_code, subtotalAmountMinor, deliveryAmountMinor, totalAmountMinor, deliveryDetails: details as Record<string, string | number | boolean>, confirmationIdempotencyKey: root.confirmation_idempotency_key, confirmationPayloadHash: root.confirmation_payload_hash, createdAt: date(root.created_at), confirmedAt: date(root.confirmed_at), items: snapshot.items as readonly ConfirmedOrderSnapshotItem[], snapshot });
}
