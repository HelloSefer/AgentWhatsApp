import dotenv from "dotenv";
import { closeDatabasePool } from "../client/database-pool.service";
import { isDatabaseInfrastructureError } from "../errors/database.errors";
import { getDatabaseMigrationStatus, runDatabaseMigrations } from "./migration-runner.service";

dotenv.config();

function safeFailure(error: unknown): Readonly<{ category: string; message: string }> {
  if (isDatabaseInfrastructureError(error)) {
    return { category: error.category, message: error.publicMessage };
  }
  return { category: "migration_failed", message: "Database migration command failed." };
}

export async function runMigrationCommand(mode: "migrate" | "status"): Promise<number> {
  try {
    const result = mode === "migrate"
      ? await runDatabaseMigrations()
      : await getDatabaseMigrationStatus();
    process.stdout.write(`${JSON.stringify({ ok: true, mode, result })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, mode, error: safeFailure(error) })}\n`);
    return 1;
  } finally {
    await closeDatabasePool();
  }
}

if (require.main === module) {
  const mode = process.argv[2] === "status" ? "status" : "migrate";
  runMigrationCommand(mode).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
