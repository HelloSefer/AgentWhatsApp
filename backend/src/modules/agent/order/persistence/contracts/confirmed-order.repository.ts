import type { DatabaseTransactionExecutor, TenantContext } from "../../../../../infrastructure/database";
import type { ConfirmedOrderList, PersistedConfirmedOrder } from "../domain/confirmed-order-persistence.types";
import type { ConfirmedOrderSnapshot } from "../../confirmed-order/confirmed-order-snapshot.types";

export type ConfirmedOrderTransactionalAppend = (
  transaction: DatabaseTransactionExecutor,
  input: Readonly<{ order: PersistedConfirmedOrder; snapshot: ConfirmedOrderSnapshot }>,
) => Promise<void>;

export interface ConfirmedOrderRepository {
  persistConfirmedOrder(tenant: TenantContext, input: Readonly<{ snapshot: ConfirmedOrderSnapshot; confirmationIdempotencyKey: string; transactionalAppend?: ConfirmedOrderTransactionalAppend }>): Promise<PersistedConfirmedOrder>;
  findConfirmedOrder(tenant: TenantContext, orderId: string): Promise<PersistedConfirmedOrder | null>;
  findConfirmedOrderSnapshot(tenant: TenantContext, orderId: string): Promise<ConfirmedOrderSnapshot | null>;
  listConfirmedOrders(tenant: TenantContext, input: Readonly<{ limit: number; cursor?: string }>): Promise<ConfirmedOrderList>;
}
