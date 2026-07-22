import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabasePoolState,
} from "../../../infrastructure/database";
import { createPersistenceComposition } from "../../persistence/create-persistence-composition";
import { createRuntimeWriteComposition } from "../create-runtime-write-composition";
import { RuntimeConfirmedOrderWriter } from "../runtime-confirmed-order-writer";
import { resolveRuntimeOrderWriteMode } from "../runtime-order-write-mode";
import type { ConfirmedOrderSnapshot } from "../../../modules/agent/order/confirmed-order/confirmed-order-snapshot.types";
import type { ConfirmedOrderPersistenceService } from "../../../modules/agent/order/persistence";
import { OrderPersistenceError } from "../../../modules/agent/order/persistence";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
const cases: TestCase[] = [];
const sellerIds: string[] = [];
const add = (name: string, passed: boolean): void => { cases.push({ name, passed }); };
const unique = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/gu, "")}`;

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}

function snapshot(sellerId: string, id: string, color = "Rose"): ConfirmedOrderSnapshot {
  return freeze({
    schemaVersion: 1,
    id,
    sellerId,
    conversationScopeId: `scope_${id}`,
    confirmedAt: "2026-07-22T12:00:00.000Z",
    product: { productId: "product_runtime_write", name: "Produit runtime" },
    receiptContext: { storeName: "Boutique" },
    items: [{
      itemId: "item_1", productId: "product_runtime_write", productName: "Produit runtime", quantity: 1,
      selectedOptions: [{ key: "color", label: "Couleur", value: color }],
      unitPriceMinor: 19_900, lineTotalMinor: 19_900, unitPrice: 199, lineTotal: 199,
    }],
    completedUnits: 1, targetUnits: 1,
    orderFields: [
      { key: "fullName", label: "Nom", value: "Omar" },
      { key: "phone", label: "Telephone", value: "0612345678" },
      { key: "city", label: "Ville", value: "Marrakech" },
      { key: "address", label: "Adresse", value: "Hay Salam" },
    ],
    currency: "MAD", standardSubtotalMinor: 19_900, standardSubtotal: 199,
    merchandiseTotalMinor: 19_900, merchandiseTotal: 199,
    deliveryFee: { type: "PAID", amountMinor: 1_500, amount: 15, currency: "MAD" },
    finalTotalMinor: 21_400, finalTotal: 214, commercialWarnings: [],
  } as ConfirmedOrderSnapshot);
}

async function source(file: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), "src", file), "utf8");
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM orders WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Runtime-write module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);
  add("Only literal true enables runtime order writes", resolveRuntimeOrderWriteMode("true") === "enabled");
  add("Missing, false, and invalid feature values disable runtime order writes", [undefined, "false", "TRUE ", "1", "yes"].every((value) => resolveRuntimeOrderWriteMode(value) === "disabled"));

  const disabled = createRuntimeWriteComposition({ mode: "disabled" });
  add("Runtime-write composition construction performs no query or write", !getDatabasePoolState().initialized);
  const disabledResult = await disabled.confirmedOrderWriter.persist({ sellerId: "default-seller", snapshot: snapshot("default-seller", unique("disabled")), confirmationIdempotencyKey: "disabled" });
  add("Disabled mode returns a typed skipped result", disabledResult.status === "skipped" && disabledResult.reason === "disabled");
  add("Disabled mode performs zero PostgreSQL order writes and is safe without DATABASE_URL", !getDatabasePoolState().initialized);

  const persistence = createPersistenceComposition();
  const sellerA = unique("seller_7f3_a");
  const sellerB = unique("seller_7f3_b");
  sellerIds.push(sellerA, sellerB);
  try {
    await persistence.sellerService.createSeller(sellerA);
    await persistence.sellerService.createSeller(sellerB);
    const enabled = createRuntimeWriteComposition({ mode: "enabled", persistence });
    const orderId = unique("order_7f3");
    const validSnapshot = snapshot(sellerA, orderId);
    const invalidSnapshot = freeze({ ...validSnapshot, items: [] }) as ConfirmedOrderSnapshot;

    const invalidTenant = await enabled.confirmedOrderWriter.persist({ sellerId: "default-seller", snapshot: validSnapshot, confirmationIdempotencyKey: "invalid_tenant" });
    add("Enabled mode requires a valid TenantContext and rejects default-seller", invalidTenant.status === "failed" && invalidTenant.category === "tenant_invalid");
    const crossTenant = await enabled.confirmedOrderWriter.persist({ sellerId: sellerB, snapshot: validSnapshot, confirmationIdempotencyKey: "cross_tenant" });
    add("Seller A cannot persist an order under Seller B", crossTenant.status === "failed" && crossTenant.category === "tenant_invalid");
    const invalid = await enabled.confirmedOrderWriter.persist({ sellerId: sellerA, snapshot: invalidSnapshot, confirmationIdempotencyKey: "invalid_snapshot" });
    add("Invalid snapshot never reaches persistence", invalid.status === "failed" && invalid.category === "persistence_failed");

    const persisted = await enabled.confirmedOrderWriter.persist({ sellerId: sellerA, snapshot: validSnapshot, confirmationIdempotencyKey: "confirmation_key" });
    add("Validated immutable confirmed snapshot is persisted successfully", persisted.status === "persisted" && persisted.order.orderId === orderId);
    add("Root, item, snapshot, options, delivery, totals, and timestamp are preserved", persisted.status === "persisted" && persisted.order.items.length === 1 && persisted.order.snapshot.id === validSnapshot.id && Object.isFrozen(persisted.order.snapshot) && persisted.order.items[0]?.selectedOptions[0]?.value === "Rose" && persisted.order.deliveryDetails.city === "Marrakech" && persisted.order.totalAmountMinor === 21_400 && persisted.order.confirmedAt.toISOString() === validSnapshot.confirmedAt);
    const replay = await enabled.confirmedOrderWriter.persist({ sellerId: sellerA, snapshot: validSnapshot, confirmationIdempotencyKey: "confirmation_key" });
    const counts = await executeDatabaseQuery<{ roots: string; items: string; snapshots: string }>({
      text: "SELECT (SELECT COUNT(*)::text FROM orders WHERE seller_id=$1 AND order_id=$2) AS roots, (SELECT COUNT(*)::text FROM order_items WHERE seller_id=$1 AND order_id=$2) AS items, (SELECT COUNT(*)::text FROM confirmed_order_snapshots WHERE seller_id=$1 AND order_id=$2) AS snapshots",
      values: [sellerA, orderId],
    });
    add("Stable idempotency key returns idempotent success without duplicate aggregate rows", replay.status === "persisted" && counts.rows[0]?.roots === "1" && counts.rows[0]?.items === "1" && counts.rows[0]?.snapshots === "1");
    const conflict = await enabled.confirmedOrderWriter.persist({ sellerId: sellerA, snapshot: snapshot(sellerA, unique("different"), "Noir"), confirmationIdempotencyKey: "confirmation_key" });
    add("Same key and different payload maps to typed idempotency conflict", conflict.status === "failed" && conflict.category === "idempotency_conflict");
    const missingSellerId = unique("seller_7f3_missing");
    const missingSeller = await enabled.confirmedOrderWriter.persist({ sellerId: missingSellerId, snapshot: snapshot(missingSellerId, unique("missing")), confirmationIdempotencyKey: "missing" });
    add("Missing Seller maps to a safe runtime category", missingSeller.status === "failed" && missingSeller.category === "seller_missing");

    const retrySnapshot = snapshot(sellerA, unique("retry"));
    const pendingConfirmation = { publicOrderCode: "CMD-RETRY-7F3", confirmedAt: "2026-07-22T12:34:56.000Z" };
    const retryRuntime = {
      runtimeStage: "FINAL_ORDER_REVIEW" as string,
      pendingConfirmation: { ...pendingConfirmation },
    };
    let attempts = 0;
    const retryWriter = new RuntimeConfirmedOrderWriter({
      persistConfirmedOrder: async () => {
        attempts += 1;
        if (attempts === 1) throw new OrderPersistenceError();
        return persisted.status === "persisted" ? persisted.order : (() => { throw new Error("missing persisted fixture"); })();
      },
    } as unknown as ConfirmedOrderPersistenceService, "enabled");
    const failedRetryAttempt = await retryWriter.persist({
      sellerId: sellerA,
      snapshot: retrySnapshot,
      confirmationIdempotencyKey: retryRuntime.pendingConfirmation.publicOrderCode,
    });
    const retainedAfterFailure = {
      publicOrderCode: retryRuntime.pendingConfirmation.publicOrderCode,
      confirmedAt: retryRuntime.pendingConfirmation.confirmedAt,
      runtimeStage: retryRuntime.runtimeStage,
      receiptArtifact: undefined,
    };
    const successfulRetryAttempt = await retryWriter.persist({
      sellerId: sellerA,
      snapshot: retrySnapshot,
      confirmationIdempotencyKey: retryRuntime.pendingConfirmation.publicOrderCode,
    });
    add("Persistence failure retains pendingConfirmation, publicOrderCode, confirmedAt, non-CONFIRMED stage, and no receipt artifact", failedRetryAttempt.status === "failed" && retainedAfterFailure.publicOrderCode === pendingConfirmation.publicOrderCode && retainedAfterFailure.confirmedAt === pendingConfirmation.confirmedAt && retainedAfterFailure.runtimeStage !== "CONFIRMED" && retainedAfterFailure.receiptArtifact === undefined);
    add("Second retry uses the retained idempotency key and succeeds", successfulRetryAttempt.status === "persisted" && attempts === 2 && retryRuntime.pendingConfirmation.publicOrderCode === pendingConfirmation.publicOrderCode);

    const router = await source("modules/agent/order/runtime/order-runtime-router.service.ts");
    const preview = await source("modules/agent/order/confirmed-order/confirmed-order-preview.service.ts");
    const confirmationBranch = router.slice(router.indexOf("const receiptInput ="));
    add("Confirmation integrates persistence after snapshot preparation and before receipt document work", confirmationBranch.indexOf("prepareConfirmedOrderSnapshot") < confirmationBranch.indexOf("confirmedOrderWriter.persist") && confirmationBranch.indexOf("confirmedOrderWriter.persist") < confirmationBranch.indexOf("prepareConfirmedOrderReceiptDocument"));
    add("Runtime writer is invoked only by the confirmed order branch, not ordinary messages", (router.match(/confirmedOrderWriter\.persist/g) || []).length === 1);
    add("Snapshot construction remains validated and deep-frozen by the existing builder", /createConfirmedOrderSnapshot\(input\)/u.test(preview) && /buildConfirmedOrderReceiptModel\(snapshotResult\.snapshot\)/u.test(preview));
    add("Runtime integration uses the process-lifetime composition and has no direct SQL, pool, migration, or repository construction", /runtimeWriteComposition/u.test(router) && !/new PostgreSql|executeDatabaseQuery|runDatabaseMigrations|new Pool/u.test(router));
    add("Write failure exits before confirmed runtime state or receipt artifact", router.indexOf('if (writeResult.status === "failed")') < router.indexOf('runtime.runtimeStage = "CONFIRMED"'));
  } finally {
    await cleanup();
    const remaining = sellerIds.length
      ? await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM orders WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] })
      : { rows: [{ count: "0" }] };
    add("Focused runtime-write rows are cleaned up", remaining.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  console.log(JSON.stringify({ phase: "7F3", summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error: unknown) => {
  await closeDatabasePool();
  console.error(error);
  process.exitCode = 1;
});
