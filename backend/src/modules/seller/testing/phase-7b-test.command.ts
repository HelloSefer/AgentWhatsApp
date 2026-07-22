import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
} from "../../../infrastructure/database";
import { SellerService } from "../application/seller.service";
import { SellerAlreadyExistsError, SellerValidationError } from "../domain/seller.errors";
import { PostgreSqlSellerRepository } from "../infrastructure/postgresql/postgresql-seller.repository";

dotenv.config();

type TestCase = Readonly<{
  name: string;
  passed: boolean;
}>;

const cases: TestCase[] = [];
const createdSellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueSellerId(): string {
  return `seller_phase7b_${randomUUID().replace(/-/gu, "")}`;
}

async function expectsError(
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

async function cleanup(): Promise<void> {
  if (!createdSellerIds.length) return;
  await executeDatabaseQuery({
    text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])",
    values: [createdSellerIds],
  });
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Seller module import does not initialize a pool", !getDatabasePoolState().initialized);

  const repository = new PostgreSqlSellerRepository();
  const service = new SellerService(repository);
  const sellerId = uniqueSellerId();
  const sellerBId = uniqueSellerId();
  const unknownSellerId = uniqueSellerId();

  try {
    for (const invalid of [undefined, null, "", "   ", "x".repeat(129), "default-seller", "Default Seller", "default_seller"]) {
      add(`Seller validation rejects ${String(invalid).slice(0, 20)}`, await expectsError(
        () => service.createSeller(invalid),
        (error) => error instanceof SellerValidationError,
      ));
    }

    const migrationStatus = await getDatabaseMigrationStatus();
    add("Seller migration is applied before persistence tests", migrationStatus.applied.includes("0001"));

    const created = await service.createSeller(` ${sellerId} `);
    createdSellerIds.push(sellerId);
    add("Valid Seller ID is trimmed and accepted", created.sellerId === sellerId);
    add("createdAt is a valid Date", created.createdAt instanceof Date && !Number.isNaN(created.createdAt.getTime()));
    add("updatedAt is a valid Date", created.updatedAt instanceof Date && !Number.isNaN(created.updatedAt.getTime()));

    const tenantA = createTenantContext(sellerId);
    const found = await service.getSeller(tenantA);
    add("Created Seller is found by TenantContext", found?.sellerId === sellerId);
    add("exists returns true for created Seller", await service.sellerExists(tenantA));

    const unknownTenant = createTenantContext(unknownSellerId);
    add("Unknown Seller returns null", await service.getSeller(unknownTenant) === null);
    add("Unknown Seller exists returns false", (await service.sellerExists(unknownTenant)) === false);

    const createdB = await service.createSeller(sellerBId);
    createdSellerIds.push(sellerBId);
    add("Seller A lookup never returns Seller B", (await service.getSeller(tenantA))?.sellerId !== createdB.sellerId);

    add("Duplicate Seller maps to SellerAlreadyExistsError", await expectsError(
      () => service.createSeller(sellerId),
      (error) => error instanceof SellerAlreadyExistsError,
    ));

    const columns = await executeDatabaseQuery<{ column_name: string }>({
      text: `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sellers'
        ORDER BY ordinal_position
      `,
    });
    add("Seller table contains only expected explicit columns", columns.rows.map((row) => row.column_name).join("|") === "seller_id|created_at|updated_at");
  } finally {
    await cleanup();
    const remaining = createdSellerIds.length
      ? await executeDatabaseQuery<{ count: string }>({
        text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])",
        values: [createdSellerIds],
      })
      : { rows: [{ count: "0" }] };
    add("Seller test rows are cleaned up", remaining.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length },
    cases,
  })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 7B seller persistence test failed safely." })}\n`);
  process.exitCode = 1;
});
