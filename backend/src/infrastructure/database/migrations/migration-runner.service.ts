import { executeDatabaseQuery } from "../client/database-pool.service";
import { DatabaseMigrationError, isDatabaseInfrastructureError } from "../errors/database.errors";
import { withTransaction } from "../transactions/with-transaction.service";
import { discoverDatabaseMigrations } from "./migration-discovery.service";
import type { MigrationRunResult, MigrationStatus } from "./migration.types";

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function ensureMigrationMetadata(): Promise<void> {
  await executeDatabaseQuery({ text: MIGRATION_TABLE_SQL });
}

async function appliedMigrationIds(): Promise<readonly string[]> {
  const result = await executeDatabaseQuery<{ id: string }>({
    text: "SELECT id FROM schema_migrations ORDER BY id ASC",
  });
  return result.rows.map((row) => row.id);
}

export async function getDatabaseMigrationStatus(): Promise<MigrationStatus> {
  await ensureMigrationMetadata();
  const [migrations, applied] = await Promise.all([
    discoverDatabaseMigrations(),
    appliedMigrationIds(),
  ]);
  const appliedSet = new Set(applied);
  return {
    metadataReady: true,
    applied,
    pending: migrations.filter((migration) => !appliedSet.has(migration.id)).map((migration) => migration.id),
  };
}

export async function runDatabaseMigrations(): Promise<MigrationRunResult> {
  try {
    await ensureMigrationMetadata();
    const migrations = await discoverDatabaseMigrations();
    const appliedSet = new Set(await appliedMigrationIds());
    const applied: string[] = [];

    for (const migration of migrations) {
      if (appliedSet.has(migration.id)) continue;
      await withTransaction(async (transaction) => {
        if (migration.sql.trim()) {
          await transaction.execute({ text: migration.sql });
        }
        await transaction.execute({
          text: "INSERT INTO schema_migrations (id) VALUES ($1)",
          values: [migration.id],
        });
      });
      applied.push(migration.id);
      appliedSet.add(migration.id);
    }

    return {
      applied,
      pending: migrations.filter((migration) => !appliedSet.has(migration.id)).map((migration) => migration.id),
    };
  } catch (error) {
    if (isDatabaseInfrastructureError(error)) throw error;
    throw new DatabaseMigrationError(error);
  }
}
