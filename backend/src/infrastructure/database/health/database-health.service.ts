import { executeDatabaseQuery } from "../client/database-pool.service";
import type { DatabaseHealthResult } from "../contracts/database-health.types";
import { isDatabaseInfrastructureError } from "../errors/database.errors";

export async function getDatabaseHealth(): Promise<DatabaseHealthResult> {
  const startedAt = performance.now();
  try {
    await executeDatabaseQuery({ text: "SELECT 1" });
    return {
      status: "available",
      reachable: true,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reachable: false,
      errorCategory: isDatabaseInfrastructureError(error)
        ? error.category === "configuration_unavailable" || error.category === "configuration_invalid"
          ? error.category
          : "connection_unavailable"
        : "connection_unavailable",
    };
  }
}
