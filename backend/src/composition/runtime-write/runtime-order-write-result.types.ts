import type { PersistedConfirmedOrder } from "../../modules/agent/order/persistence";

export type RuntimeOrderWriteFailureCategory =
  | "tenant_invalid"
  | "seller_missing"
  | "idempotency_conflict"
  | "order_already_exists"
  | "database_unavailable"
  | "persistence_failed";

export type RuntimeConfirmedOrderWriteResult =
  | Readonly<{ status: "skipped"; reason: "disabled" }>
  | Readonly<{ status: "persisted"; order: PersistedConfirmedOrder }>
  | Readonly<{ status: "failed"; category: RuntimeOrderWriteFailureCategory }>;
