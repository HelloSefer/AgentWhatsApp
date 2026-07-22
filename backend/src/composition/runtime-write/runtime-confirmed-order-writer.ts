import {
  ConfirmedOrderValidationError,
  OrderAlreadyExistsError,
  OrderIdempotencyConflictError,
  OrderPersistenceError,
  OrderSellerNotFoundError,
  type ConfirmedOrderPersistenceService,
} from "../../modules/agent/order/persistence";
import type { ConfirmedOrderSnapshot } from "../../modules/agent/order/confirmed-order/confirmed-order-snapshot.types";
import {
  createTenantContext,
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseQueryError,
  InvalidTenantContextError,
} from "../../infrastructure/database";
import type { RuntimeOrderWriteMode } from "./runtime-order-write-mode";
import type {
  RuntimeConfirmedOrderWriteResult,
  RuntimeOrderWriteFailureCategory,
} from "./runtime-order-write-result.types";

function failureCategory(error: unknown): RuntimeOrderWriteFailureCategory {
  if (error instanceof InvalidTenantContextError) return "tenant_invalid";
  if (error instanceof ConfirmedOrderValidationError) return "persistence_failed";
  if (error instanceof OrderSellerNotFoundError) return "seller_missing";
  if (error instanceof OrderIdempotencyConflictError) return "idempotency_conflict";
  if (error instanceof OrderAlreadyExistsError) return "order_already_exists";
  if (error instanceof DatabaseConfigurationError || error instanceof DatabaseConnectionError || error instanceof DatabaseQueryError) return "database_unavailable";
  if (error instanceof OrderPersistenceError) return "persistence_failed";
  return "persistence_failed";
}

/** Coordinates the feature-gated runtime write without exposing database details to order runtime. */
export class RuntimeConfirmedOrderWriter {
  constructor(
    private readonly confirmedOrderPersistenceService: ConfirmedOrderPersistenceService,
    private readonly mode: RuntimeOrderWriteMode,
  ) {}

  async persist(input: Readonly<{
    sellerId: string;
    snapshot: ConfirmedOrderSnapshot;
    confirmationIdempotencyKey: string;
  }>): Promise<RuntimeConfirmedOrderWriteResult> {
    if (this.mode === "disabled") return { status: "skipped", reason: "disabled" };

    try {
      const tenant = createTenantContext(input.sellerId);
      if (input.snapshot.sellerId !== tenant.sellerId || !Object.isFrozen(input.snapshot)) {
        return { status: "failed", category: "tenant_invalid" };
      }
      const order = await this.confirmedOrderPersistenceService.persistConfirmedOrder(tenant, {
        snapshot: input.snapshot,
        confirmationIdempotencyKey: input.confirmationIdempotencyKey,
      });
      return { status: "persisted", order };
    } catch (error) {
      return { status: "failed", category: failureCategory(error) };
    }
  }
}
