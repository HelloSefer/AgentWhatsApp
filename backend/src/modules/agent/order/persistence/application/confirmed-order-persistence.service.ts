import type { TenantContext } from "../../../../../infrastructure/database";
import type { ConfirmedOrderSnapshot } from "../../confirmed-order/confirmed-order-snapshot.types";
import type { ConfirmedOrderRepository } from "../contracts/confirmed-order.repository";
import type { ConfirmedOrderList, PersistedConfirmedOrder } from "../domain/confirmed-order-persistence.types";
import { ConfirmedOrderValidationError } from "../domain/order-persistence.errors";
import { validateConfirmedOrderPersistenceInput } from "../domain/order-persistence.validation";

function orderId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) throw new ConfirmedOrderValidationError();
  return value.trim();
}

export class ConfirmedOrderPersistenceService {
  constructor(private readonly repository: ConfirmedOrderRepository) {}

  persistConfirmedOrder(tenant: TenantContext, input: Readonly<{ snapshot: ConfirmedOrderSnapshot; confirmationIdempotencyKey: unknown }>): Promise<PersistedConfirmedOrder> {
    const validated = validateConfirmedOrderPersistenceInput(input);
    if (validated.snapshot.sellerId.trim() !== tenant.sellerId) throw new ConfirmedOrderValidationError();
    return this.repository.persistConfirmedOrder(tenant, { snapshot: validated.snapshot, confirmationIdempotencyKey: validated.idempotencyKey });
  }

  getConfirmedOrder(tenant: TenantContext, id: unknown): Promise<PersistedConfirmedOrder | null> { return this.repository.findConfirmedOrder(tenant, orderId(id)); }
  getConfirmedOrderSnapshot(tenant: TenantContext, id: unknown): Promise<ConfirmedOrderSnapshot | null> { return this.repository.findConfirmedOrderSnapshot(tenant, orderId(id)); }
  listConfirmedOrders(tenant: TenantContext, input: Readonly<{ limit?: unknown; cursor?: unknown }> = {}): Promise<ConfirmedOrderList> {
    const limit = input.limit === undefined ? 25 : input.limit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new ConfirmedOrderValidationError();
    if (input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor.trim() || input.cursor.length > 512)) {
      throw new ConfirmedOrderValidationError();
    }
    const cursor = input.cursor === undefined ? undefined : input.cursor;
    return this.repository.listConfirmedOrders(tenant, { limit: limit as number, cursor });
  }
}
