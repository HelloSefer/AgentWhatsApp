export type QueueErrorCategory =
  | "configuration_unavailable"
  | "configuration_invalid"
  | "connection_unavailable"
  | "duplicate_registration"
  | "queue_not_registered"
  | "invalid_queue_name"
  | "invalid_job_identity"
  | "resource_closed"
  | "worker_startup_failed"
  | "operation_failed";

export class QueueInfrastructureError extends Error {
  public readonly category: QueueErrorCategory;
  public readonly cause?: unknown;

  constructor(category: QueueErrorCategory, cause?: unknown) {
    super(`Queue infrastructure error: ${category}`);
    this.name = "QueueInfrastructureError";
    this.category = category;
    this.cause = cause;
  }
}

export class QueueConfigurationError extends QueueInfrastructureError {
  constructor(category: "configuration_unavailable" | "configuration_invalid", cause?: unknown) {
    super(category, cause);
    this.name = "QueueConfigurationError";
  }
}

export class QueueConnectionError extends QueueInfrastructureError {
  constructor(cause?: unknown) {
    super("connection_unavailable", cause);
    this.name = "QueueConnectionError";
  }
}

export class QueueRegistrationError extends QueueInfrastructureError {
  constructor(category: "duplicate_registration" | "queue_not_registered" | "invalid_queue_name") {
    super(category);
    this.name = "QueueRegistrationError";
  }
}

export class QueueJobIdentityError extends QueueInfrastructureError {
  constructor() {
    super("invalid_job_identity");
    this.name = "QueueJobIdentityError";
  }
}

export class QueueResourceClosedError extends QueueInfrastructureError {
  constructor() {
    super("resource_closed");
    this.name = "QueueResourceClosedError";
  }
}

export class QueueWorkerStartupError extends QueueInfrastructureError {
  constructor(cause?: unknown) {
    super("worker_startup_failed", cause);
    this.name = "QueueWorkerStartupError";
  }
}

export class QueueOperationError extends QueueInfrastructureError {
  constructor(cause?: unknown) {
    super("operation_failed", cause);
    this.name = "QueueOperationError";
  }
}

export function toQueueErrorCategory(error: unknown): QueueErrorCategory {
  if (error instanceof QueueInfrastructureError) return error.category;
  return "operation_failed";
}
