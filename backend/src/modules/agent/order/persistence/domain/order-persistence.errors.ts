export class ConfirmedOrderValidationError extends Error { constructor() { super("Confirmed order is invalid."); this.name = "ConfirmedOrderValidationError"; } }
export class OrderIdempotencyConflictError extends Error { constructor() { super("Confirmation idempotency key conflicts with a different order."); this.name = "OrderIdempotencyConflictError"; } }
export class OrderAlreadyExistsError extends Error { constructor() { super("Confirmed order already exists."); this.name = "OrderAlreadyExistsError"; } }
export class OrderSellerNotFoundError extends Error { constructor() { super("Order seller was not found."); this.name = "OrderSellerNotFoundError"; } }
export class OrderPersistenceError extends Error { readonly cause?: unknown; constructor(cause?: unknown) { super("Confirmed order persistence failed."); this.name = "OrderPersistenceError"; this.cause = cause; } }
export class ConfirmedOrderCorruptedError extends Error { constructor() { super("Stored confirmed order is corrupted."); this.name = "ConfirmedOrderCorruptedError"; } }
