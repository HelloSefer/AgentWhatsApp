import { DatabaseConfigurationError } from "../errors/database.errors";

export type DatabaseConfiguration = Readonly<{
  connectionString: string;
}>;

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export function validateDatabaseUrl(value: unknown): DatabaseConfiguration {
  if (typeof value !== "string" || !value.trim()) {
    throw new DatabaseConfigurationError("configuration_unavailable");
  }

  try {
    const parsed = new URL(value.trim());
    if (
      !POSTGRES_PROTOCOLS.has(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.pathname ||
      parsed.pathname === "/"
    ) {
      throw new DatabaseConfigurationError("configuration_invalid");
    }

    return { connectionString: value.trim() };
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) throw error;
    throw new DatabaseConfigurationError("configuration_invalid");
  }
}

/** Reads only DATABASE_URL and validates it at the point of database use. */
export function getDatabaseConfiguration(): DatabaseConfiguration {
  return validateDatabaseUrl(process.env.DATABASE_URL);
}
