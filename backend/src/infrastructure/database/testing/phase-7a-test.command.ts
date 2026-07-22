import dotenv from "dotenv";
import app from "../../../app";
import { validateDatabaseUrl } from "../config/database-config.service";
import {
  closeDatabasePool,
  executeDatabaseQuery,
  getDatabasePoolState,
} from "../client/database-pool.service";
import { createTenantContext } from "../contracts/tenant-context";
import { DatabaseConfigurationError, InvalidTenantContextError } from "../errors/database.errors";
import { getDatabaseHealth } from "../health/database-health.service";
import { getDatabaseMigrationStatus, runDatabaseMigrations } from "../migrations/migration-runner.service";
import { withTransaction } from "../transactions/with-transaction.service";

dotenv.config();

type TestCase = Readonly<{
  name: string;
  passed: boolean;
  skipped?: boolean;
}>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean, skipped = false): void {
  cases.push({ name, passed, ...(skipped ? { skipped: true } : {}) });
}

async function expectsFailure(
  callback: () => Promise<unknown>,
  isExpected: (error: unknown) => boolean,
): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
}

async function runMissingConfigurationChecks(): Promise<void> {
  const previous = process.env.DATABASE_URL;
  await closeDatabasePool();
  delete process.env.DATABASE_URL;
  try {
    add("database import state does not initialize pool", !getDatabasePoolState().initialized);
    add("app import stays independent from database configuration", Boolean(app));
    const health = await getDatabaseHealth();
    add("missing configuration health is safely unavailable", health.status === "unavailable" && health.errorCategory === "configuration_unavailable");
    add("missing configuration query fails safely", await expectsFailure(
      () => executeDatabaseQuery({ text: "SELECT 1" }),
      (error) => error instanceof DatabaseConfigurationError,
    ));
    add("missing configuration never creates a default pool", !getDatabasePoolState().initialized);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

function runConfigurationAndTenantChecks(): void {
  add("valid PostgreSQL URL is accepted", Boolean(validateDatabaseUrl("postgresql://user:password@localhost:5432/agent_whatsapp")));
  add("unsupported database protocol is rejected", (() => {
    try {
      validateDatabaseUrl("mysql://localhost/agent_whatsapp");
      return false;
    } catch (error) {
      return error instanceof DatabaseConfigurationError;
    }
  })());
  add("tenant accepts and trims a seller id", createTenantContext(" seller_demo ").sellerId === "seller_demo");
  for (const value of [undefined, null, "", "   ", "default-seller", " Default Seller ", "default_seller"]) {
    try {
      createTenantContext(value);
      add(`tenant rejects ${String(value)}`, false);
    } catch (error) {
      add(`tenant rejects ${String(value)}`, error instanceof InvalidTenantContextError);
    }
  }
}

async function runLocalDatabaseChecks(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    add("local database checks require DATABASE_URL", false, true);
    return;
  }

  const health = await getDatabaseHealth();
  add("configured database health is available", health.status === "available" && health.reachable);
  if (!health.reachable) return;

  const directQuery = await executeDatabaseQuery<{ value: number }>({ text: "SELECT 1 AS value" });
  add("parameterized query path reaches PostgreSQL", directQuery.rows[0]?.value === 1);

  const before = await getDatabaseMigrationStatus();
  add("migration status initializes only metadata", before.metadataReady && Array.isArray(before.applied) && Array.isArray(before.pending));
  const firstRun = await runDatabaseMigrations();
  add("explicit migration run completes safely", Array.isArray(firstRun.applied));
  const secondRun = await runDatabaseMigrations();
  add("second migration run is idempotent", secondRun.applied.length === 0);
  const after = await getDatabaseMigrationStatus();
  add("migration status has no duplicate applied identifiers", new Set(after.applied).size === after.applied.length);

  const committedValue = await withTransaction(async (transaction) => {
    await transaction.execute({ text: "CREATE TEMPORARY TABLE phase7a_transaction_probe (value INTEGER) ON COMMIT DROP" });
    await transaction.execute({ text: "INSERT INTO phase7a_transaction_probe (value) VALUES ($1)", values: [1] });
    const result = await transaction.execute<{ value: number }>({ text: "SELECT value FROM phase7a_transaction_probe" });
    return result.rows[0]?.value;
  });
  add("successful transaction commits", committedValue === 1);

  const rollbackPreserved = await expectsFailure(
    () => withTransaction(async (transaction) => {
      await transaction.execute({ text: "CREATE TEMPORARY TABLE phase7a_rollback_probe (value INTEGER) ON COMMIT DROP" });
      throw new Error("phase7a rollback probe");
    }),
    (error) => error instanceof Error && error.message === "phase7a rollback probe",
  );
  add("failed transaction rolls back and preserves callback error", rollbackPreserved);
  await executeDatabaseQuery({ text: "SELECT 1" });
  add("transaction client is released and pool remains usable", getDatabasePoolState().waitingCount === 0);
}

async function main(): Promise<void> {
  runConfigurationAndTenantChecks();
  await runMissingConfigurationChecks();
  await runLocalDatabaseChecks();
  await closeDatabasePool();
  add("pool shutdown is safe after initialization", !getDatabasePoolState().initialized);
  await closeDatabasePool();
  add("pool shutdown is safe before initialization", !getDatabasePoolState().initialized);

  const failed = cases.filter((entry) => !entry.passed && !entry.skipped);
  process.stdout.write(`${JSON.stringify({
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length, skipped: cases.filter((entry) => entry.skipped).length },
    cases,
  })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 7A database test failed safely." })}\n`);
  process.exitCode = 1;
});
