export type DatabaseErrorCategory =
  | "configuration_unavailable"
  | "configuration_invalid"
  | "connection_unavailable"
  | "query_failed"
  | "migration_failed"
  | "duplicate_migration_identifier"
  | "invalid_tenant_context";

export class DatabaseInfrastructureError extends Error {
  readonly category: DatabaseErrorCategory;
  readonly publicMessage: string;
  readonly cause?: unknown;

  constructor(input: {
    category: DatabaseErrorCategory;
    publicMessage: string;
    cause?: unknown;
  }) {
    super(input.publicMessage);
    this.name = "DatabaseInfrastructureError";
    this.category = input.category;
    this.publicMessage = input.publicMessage;
    this.cause = input.cause;
  }
}

export class DatabaseConfigurationError extends DatabaseInfrastructureError {
  constructor(category: "configuration_unavailable" | "configuration_invalid") {
    super({
      category,
      publicMessage: category === "configuration_unavailable"
        ? "Database configuration is unavailable."
        : "Database configuration is invalid.",
    });
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseConnectionError extends DatabaseInfrastructureError {
  constructor(cause?: unknown) {
    super({
      category: "connection_unavailable",
      publicMessage: "Database connection is unavailable.",
      cause,
    });
    this.name = "DatabaseConnectionError";
  }
}

export class DatabaseQueryError extends DatabaseInfrastructureError {
  constructor(cause?: unknown) {
    super({
      category: "query_failed",
      publicMessage: "Database query failed.",
      cause,
    });
    this.name = "DatabaseQueryError";
  }
}

export class DatabaseMigrationError extends DatabaseInfrastructureError {
  constructor(cause?: unknown) {
    super({
      category: "migration_failed",
      publicMessage: "Database migration failed.",
      cause,
    });
    this.name = "DatabaseMigrationError";
  }
}

export class DuplicateMigrationIdentifierError extends DatabaseInfrastructureError {
  constructor() {
    super({
      category: "duplicate_migration_identifier",
      publicMessage: "Duplicate database migration identifier detected.",
    });
    this.name = "DuplicateMigrationIdentifierError";
  }
}

export class InvalidTenantContextError extends DatabaseInfrastructureError {
  constructor() {
    super({
      category: "invalid_tenant_context",
      publicMessage: "Tenant context is invalid.",
    });
    this.name = "InvalidTenantContextError";
  }
}

export function isDatabaseInfrastructureError(value: unknown): value is DatabaseInfrastructureError {
  return value instanceof DatabaseInfrastructureError;
}
