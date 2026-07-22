import { DatabaseQueryError, executeDatabaseQuery, type DatabaseQueryExecutor, type TenantContext, withTransaction } from "../../../../../../infrastructure/database";
import type { ConfirmedOrderRepository } from "../../contracts/confirmed-order.repository";
import type { ConfirmedOrderList, PersistedConfirmedOrder } from "../../domain/confirmed-order-persistence.types";
import { ConfirmedOrderCorruptedError, OrderAlreadyExistsError, OrderIdempotencyConflictError, OrderPersistenceError, OrderSellerNotFoundError } from "../../domain/order-persistence.errors";
import { validateConfirmedOrderPersistenceInput } from "../../domain/order-persistence.validation";
import { fingerprintConfirmedOrderSnapshot } from "./confirmed-order-fingerprint.service";
import { mapConfirmedOrderSnapshot, mapPersistedConfirmedOrder, type OrderRow, type SnapshotRow } from "./confirmed-order-row.mapper";

const ROOT = "seller_id, order_id, customer_phone, order_status, currency_code, subtotal_amount_minor, delivery_amount_minor, total_amount_minor, delivery_details_json, confirmation_idempotency_key, confirmation_payload_hash, created_at, confirmed_at";
function code(error: unknown): string | undefined { return error instanceof DatabaseQueryError && typeof error.cause === "object" && error.cause !== null && "code" in error.cause && typeof error.cause.code === "string" ? error.cause.code : undefined; }
function constraint(error: unknown): string | undefined { return error instanceof DatabaseQueryError && typeof error.cause === "object" && error.cause !== null && "constraint" in error.cause && typeof error.cause.constraint === "string" ? error.cause.constraint : undefined; }
function decodeCursor(value: string | undefined): { confirmedAt?: string; orderId?: string } { if (!value) return {}; try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { confirmedAt?: unknown; orderId?: unknown }; if (typeof parsed.confirmedAt !== "string" || typeof parsed.orderId !== "string" || Number.isNaN(new Date(parsed.confirmedAt).getTime()) || !parsed.orderId) throw new Error(); return { confirmedAt: parsed.confirmedAt, orderId: parsed.orderId }; } catch { throw new OrderPersistenceError(); } }
function encodeCursor(confirmedAt: Date | string, orderId: string): string { return Buffer.from(JSON.stringify({ confirmedAt: new Date(confirmedAt).toISOString(), orderId }), "utf8").toString("base64url"); }

async function load(executor: DatabaseQueryExecutor, tenant: TenantContext, orderId: string): Promise<PersistedConfirmedOrder | null> {
  const root = await executor.execute<OrderRow>({ text: `SELECT ${ROOT} FROM orders WHERE seller_id = $1 AND order_id = $2 LIMIT 1`, values: [tenant.sellerId, orderId] });
  if (!root.rows[0]) return null;
  const snapshot = await executor.execute<SnapshotRow>({ text: "SELECT snapshot_json FROM confirmed_order_snapshots WHERE seller_id = $1 AND order_id = $2 LIMIT 1", values: [tenant.sellerId, orderId] });
  if (!snapshot.rows[0]) throw new ConfirmedOrderCorruptedError();
  return mapPersistedConfirmedOrder(root.rows[0], snapshot.rows[0]);
}

export class PostgreSqlConfirmedOrderRepository implements ConfirmedOrderRepository {
  constructor(private readonly testingHooks?: Readonly<{ beforeSnapshotInsert?: () => void }>) {}
  async persistConfirmedOrder(tenant: TenantContext, input: Readonly<{ snapshot: import("../../../confirmed-order/confirmed-order-snapshot.types").ConfirmedOrderSnapshot; confirmationIdempotencyKey: string }>): Promise<PersistedConfirmedOrder> {
    const validated = validateConfirmedOrderPersistenceInput(input);
    const hash = fingerprintConfirmedOrderSnapshot(validated.snapshot);
    try {
      return await withTransaction(async (transaction) => {
        await transaction.execute({ text: "INSERT INTO orders (seller_id, order_id, customer_phone, order_status, currency_code, subtotal_amount_minor, delivery_amount_minor, total_amount_minor, delivery_details_json, confirmation_idempotency_key, confirmation_payload_hash, created_at, confirmed_at) VALUES ($1,$2,$3,'CONFIRMED',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$11)", values: [tenant.sellerId, validated.orderId, validated.customerPhone, validated.snapshot.currency, validated.snapshot.merchandiseTotalMinor, validated.snapshot.deliveryFee?.amountMinor || 0, validated.snapshot.finalTotalMinor, JSON.stringify(validated.deliveryDetails), validated.idempotencyKey, hash, validated.snapshot.confirmedAt] });
        for (const [position, item] of validated.snapshot.items.entries()) {
          await transaction.execute({ text: "INSERT INTO order_items (seller_id, order_id, item_position, product_id, product_name_snapshot, quantity, selected_options_json, unit_price_amount_minor, line_total_amount_minor) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)", values: [tenant.sellerId, validated.orderId, position, item.productId, item.productName, item.quantity, JSON.stringify(item.selectedOptions), item.unitPriceMinor, item.lineTotalMinor] });
        }
        this.testingHooks?.beforeSnapshotInsert?.();
        await transaction.execute({ text: "INSERT INTO confirmed_order_snapshots (seller_id, order_id, schema_version, snapshot_json, snapshot_hash, created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6)", values: [tenant.sellerId, validated.orderId, validated.snapshot.schemaVersion, JSON.stringify(validated.snapshot), hash, validated.snapshot.confirmedAt] });
        const result = await load(transaction, tenant, validated.orderId);
        if (!result) throw new OrderPersistenceError();
        return result;
      });
    } catch (error) {
      if (code(error) === "23503") throw new OrderSellerNotFoundError();
      if (code(error) === "23505") {
        const existingByKey = await executeDatabaseQuery<OrderRow>({ text: `SELECT ${ROOT} FROM orders WHERE seller_id = $1 AND confirmation_idempotency_key = $2 LIMIT 1`, values: [tenant.sellerId, validated.idempotencyKey] });
        if (existingByKey.rows[0]) {
          if (existingByKey.rows[0].confirmation_payload_hash !== hash) throw new OrderIdempotencyConflictError();
          const existing = await this.findConfirmedOrder(tenant, existingByKey.rows[0].order_id);
          if (!existing) throw new OrderPersistenceError();
          return existing;
        }
        if (constraint(error) === "orders_pkey" || constraint(error) === undefined) throw new OrderAlreadyExistsError();
      }
      if (error instanceof OrderPersistenceError || error instanceof OrderSellerNotFoundError || error instanceof OrderAlreadyExistsError || error instanceof OrderIdempotencyConflictError || error instanceof ConfirmedOrderCorruptedError) throw error;
      throw new OrderPersistenceError(error);
    }
  }

  async findConfirmedOrder(tenant: TenantContext, orderId: string): Promise<PersistedConfirmedOrder | null> { try { return await load({ execute: executeDatabaseQuery }, tenant, orderId); } catch (error) { if (error instanceof ConfirmedOrderCorruptedError) throw error; throw new OrderPersistenceError(error); } }
  async findConfirmedOrderSnapshot(tenant: TenantContext, orderId: string): Promise<import("../../../confirmed-order/confirmed-order-snapshot.types").ConfirmedOrderSnapshot | null> { try { const result = await executeDatabaseQuery<SnapshotRow>({ text: "SELECT snapshot_json FROM confirmed_order_snapshots WHERE seller_id = $1 AND order_id = $2 LIMIT 1", values: [tenant.sellerId, orderId] }); return result.rows[0] ? mapConfirmedOrderSnapshot(result.rows[0]) : null; } catch (error) { if (error instanceof ConfirmedOrderCorruptedError) throw error; throw new OrderPersistenceError(error); } }
  async listConfirmedOrders(tenant: TenantContext, input: Readonly<{ limit: number; cursor?: string }>): Promise<ConfirmedOrderList> { try { const cursor = decodeCursor(input.cursor); const result = await executeDatabaseQuery<{ order_id: string; customer_phone: string; currency_code: string; total_amount_minor: string | number; confirmed_at: Date | string }>({ text: "SELECT order_id, customer_phone, currency_code, total_amount_minor, confirmed_at FROM orders WHERE seller_id = $1 AND ($2::timestamptz IS NULL OR confirmed_at < $2::timestamptz OR (confirmed_at = $2::timestamptz AND order_id < $3)) ORDER BY confirmed_at DESC, order_id DESC LIMIT $4", values: [tenant.sellerId, cursor.confirmedAt || null, cursor.orderId || null, input.limit + 1] }); const rows = result.rows.slice(0, input.limit); return { orders: rows.map((row) => ({ orderId: row.order_id, customerPhone: row.customer_phone, currencyCode: row.currency_code, totalAmountMinor: Number(row.total_amount_minor), confirmedAt: new Date(row.confirmed_at) })), nextCursor: result.rows.length > input.limit && rows.at(-1) ? encodeCursor(rows.at(-1)!.confirmed_at, rows.at(-1)!.order_id) : undefined }; } catch (error) { if (error instanceof OrderPersistenceError) throw error; throw new OrderPersistenceError(error); } }
}
export const postgreSqlConfirmedOrderRepository = new PostgreSqlConfirmedOrderRepository();
