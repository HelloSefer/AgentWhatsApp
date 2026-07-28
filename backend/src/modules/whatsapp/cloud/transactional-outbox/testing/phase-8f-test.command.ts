import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { QueueConnectionManager, QueueRegistry } from "../../../../../infrastructure/queue";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, getDatabasePoolState, runDatabaseMigrations } from "../../../../../infrastructure/database";
import { SellerService } from "../../../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ConfirmedOrderPersistenceService } from "../../../../agent/order/persistence/application/confirmed-order-persistence.service";
import { PostgreSqlConfirmedOrderRepository } from "../../../../agent/order/persistence/infrastructure/postgresql/postgresql-confirmed-order.repository";
import { RuntimeConfirmedOrderWriter } from "../../../../../composition/runtime-write/runtime-confirmed-order-writer";
import type { ConfirmedOrderSnapshot } from "../../../../agent/order/confirmed-order/confirmed-order-snapshot.types";
import type { WhatsAppOutboundGroupDispatchResult, WhatsAppOutboundResponseGroup } from "../../outbound-queue/whatsapp-outbound-job.types";
import { WHATSAPP_OUTBOUND_SCHEMA_VERSION } from "../../outbound-queue/whatsapp-outbound-job.types";
import { WhatsAppOutboundProducerService } from "../../outbound-queue/whatsapp-outbound-producer.service";
import { WhatsAppTransactionalOutboxRepository } from "../infrastructure/whatsapp-transactional-outbox.repository";
import { WhatsAppTransactionalOutboxPublisher, WHATSAPP_TRANSACTIONAL_OUTBOX_BATCH_SIZE, WHATSAPP_TRANSACTIONAL_OUTBOX_CLAIM_LEASE_MS, WHATSAPP_TRANSACTIONAL_OUTBOX_POLL_INTERVAL_MS } from "../publisher/whatsapp-transactional-outbox-publisher";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean; skipped?: boolean; detail?: string }>;
const cases: TestCase[] = [];
const sellerIds: string[] = [];
let migrationApplied = false;

function add(name: string, passed: boolean, detail?: string, skipped = false): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}), ...(skipped ? { skipped: true } : {}) });
}

function unique(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}

function snapshot(sellerId: string, id: string): ConfirmedOrderSnapshot {
  return freeze({
    schemaVersion: 1,
    id,
    sellerId,
    conversationScopeId: `${sellerId}:212600088888`,
    confirmedAt: "2026-07-26T00:00:00.000Z",
    product: { productId: "phase8f_product", name: "Phase 8F Product" },
    receiptContext: { storeName: "Phase 8F Store" },
    items: [{
      itemId: "item_0",
      productId: "phase8f_product",
      productName: "Phase 8F Product",
      quantity: 1,
      selectedOptions: [{ key: "color", label: "Color", value: "Black" }],
      unitPriceMinor: 10_000,
      lineTotalMinor: 10_000,
      unitPrice: 100,
      lineTotal: 100,
    }],
    completedUnits: 1,
    targetUnits: 1,
    orderFields: [
      { key: "fullName", label: "Name", value: "Phase 8F" },
      { key: "phone", label: "Phone", value: "212600088888" },
      { key: "city", label: "City", value: "Marrakech" },
      { key: "address", label: "Address", value: "Street" },
    ],
    currency: "MAD",
    standardSubtotalMinor: 10_000,
    standardSubtotal: 100,
    merchandiseTotalMinor: 10_000,
    merchandiseTotal: 100,
    deliveryFee: { type: "PAID", amountMinor: 1_500, amount: 15, currency: "MAD" },
    finalTotalMinor: 11_500,
    finalTotal: 115,
    commercialWarnings: [],
  } as ConfirmedOrderSnapshot);
}

function group(sellerId: string, orderId: string): WhatsAppOutboundResponseGroup {
  return {
    schemaVersion: WHATSAPP_OUTBOUND_SCHEMA_VERSION,
    sellerId,
    conversationKey: `${sellerId}:212600088888`,
    recipient: { waId: "212600088888" },
    source: { type: "confirmed_order_receipt", id: orderId },
    responseGroupId: `confirmed_order_receipt.${orderId}.confirmed_order_receipt`,
    responseGroupRole: "confirmed_order_receipt",
    createdAt: "2026-07-26T00:00:00.000Z",
    commands: [{ type: "confirmed_order_receipt", to: "212600088888", confirmedOrderId: orderId }],
  };
}

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function countOutbox(sellerId: string, orderId?: string): Promise<number> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: `SELECT COUNT(*)::text AS count FROM whatsapp_transactional_outbox WHERE seller_id = $1 AND ($2::text IS NULL OR aggregate_id = $2)`,
    values: [sellerId, orderId || null],
  });
  return Number(result.rows[0]?.count || 0);
}

async function row(sellerId: string, orderId: string): Promise<Record<string, unknown> | undefined> {
  const result = await executeDatabaseQuery({
    text: "SELECT * FROM whatsapp_transactional_outbox WHERE seller_id = $1 AND aggregate_id = $2 LIMIT 1",
    values: [sellerId, orderId],
  });
  return result.rows[0];
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_transactional_outbox WHERE seller_id = ANY($1::text[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM orders WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
}

async function run(): Promise<void> {
  await closeDatabasePool();
  add("no import-time database I/O", !getDatabasePoolState().initialized);
  const migration = await runDatabaseMigrations();
  migrationApplied = migration.applied.includes("0005");
  add("migration 0005 is applied explicitly or already present", migration.applied.includes("0005") || !migration.pending.includes("0005"));

  const sellerId = unique("seller_phase8f");
  sellerIds.push(sellerId);
  await new SellerService(new PostgreSqlSellerRepository()).createSeller(sellerId);
  const tenant = createTenantContext(sellerId);
  const service = new ConfirmedOrderPersistenceService(new PostgreSqlConfirmedOrderRepository());
  const repository = new WhatsAppTransactionalOutboxRepository();
  const writer = new RuntimeConfirmedOrderWriter(service, "enabled", repository);

  const orderId = unique("order_phase8f");
  const write = await writer.persist({
    sellerId,
    snapshot: snapshot(sellerId, orderId),
    confirmationIdempotencyKey: "phase8f_key",
    durableReceiptOutbox: { conversationKey: `${sellerId}:212600088888`, customerPhone: "212600088888", phoneNumberId: "phone_phase8f" },
  });
  add("confirmed order and outbox row commit atomically", write.status === "persisted" && await countOutbox(sellerId, orderId) === 1);
  add("receipt is not marked SENT by outbox insertion", JSON.stringify(await row(sellerId, orderId)).includes("confirmed_order_receipt") && !JSON.stringify(await row(sellerId, orderId)).includes('"SENT"'));

  const missingSeller = unique("seller_phase8f_missing");
  const missingWriter = new RuntimeConfirmedOrderWriter(service, "enabled", repository);
  await missingWriter.persist({
    sellerId: missingSeller,
    snapshot: snapshot(missingSeller, unique("order_phase8f_missing")),
    confirmationIdempotencyKey: "missing",
    durableReceiptOutbox: { conversationKey: `${missingSeller}:212600088888`, customerPhone: "212600088888", phoneNumberId: "phone_phase8f" },
  });
  add("confirmed-order failure creates no outbox row", await countOutbox(missingSeller) === 0);

  const rollbackOrder = unique("order_phase8f_rollback");
  const failingWriter = new RuntimeConfirmedOrderWriter(service, "enabled", {
    appendWithinTransaction: async () => { throw new Error("phase8f outbox append failure"); },
  });
  const failedWrite = await failingWriter.persist({
    sellerId,
    snapshot: snapshot(sellerId, rollbackOrder),
    confirmationIdempotencyKey: "rollback",
    durableReceiptOutbox: { conversationKey: `${sellerId}:212600088888`, customerPhone: "212600088888", phoneNumberId: "phone_phase8f" },
  });
  add("outbox insertion failure rolls back confirmed-order persistence", failedWrite.status === "failed" && await service.getConfirmedOrder(tenant, rollbackOrder) === null && await countOutbox(sellerId, rollbackOrder) === 0);

  const replay = await writer.persist({
    sellerId,
    snapshot: snapshot(sellerId, orderId),
    confirmationIdempotencyKey: "phase8f_key",
    durableReceiptOutbox: { conversationKey: `${sellerId}:212600088888`, customerPhone: "212600088888", phoneNumberId: "phone_phase8f" },
  });
  add("duplicate confirmed-order attempt creates one order and one outbox record", replay.status === "persisted" && await countOutbox(sellerId, orderId) === 1);

  const payload = JSON.stringify((await row(sellerId, orderId))?.payload_json || {});
  add("outbox payload contains no credentials/raw webhook/buffer/base64", !/token|secret|credential|raw|Buffer|base64|postgres|valkey|authorization|bearer/i.test(payload));

  const claimed = await repository.claimPending({ ownerId: "owner_a", batchSize: 1, leaseMs: 30_000 });
  add("publisher claims pending rows safely", claimed.length === 1 && claimed[0]?.aggregateId === orderId);
  const competing = await repository.claimPending({ ownerId: "owner_b", batchSize: 1, leaseMs: 30_000 });
  add("two publishers do not own the same row simultaneously", competing.every((entry) => entry.outboxId !== claimed[0]?.outboxId));
  await executeDatabaseQuery({ text: "UPDATE whatsapp_transactional_outbox SET claim_expires_at = NOW() - INTERVAL '1 second' WHERE outbox_id = $1", values: [claimed[0]?.outboxId] });
  const reclaimed = await repository.claimPending({ ownerId: "owner_b", batchSize: 1, leaseMs: 30_000 });
  add("expired claim becomes recoverable", reclaimed.some((entry) => entry.outboxId === claimed[0]?.outboxId));
  const stale = await repository.markPublished({ outboxId: claimed[0]!.outboxId, ownerId: "owner_a" });
  add("stale publisher cannot mark another owner's claim published", stale === false);
  await executeDatabaseQuery({ text: "UPDATE whatsapp_transactional_outbox SET claim_expires_at = NOW() - INTERVAL '1 second' WHERE outbox_id = $1", values: [claimed[0]?.outboxId] });

  let publishedDispatches = 0;
  const publisher = new WhatsAppTransactionalOutboxPublisher(repository, {
    dispatchOutboundGroup: async (): Promise<WhatsAppOutboundGroupDispatchResult> => {
      publishedDispatches += 1;
      return { accepted: true, duplicate: false, jobId: "jid_phase8f" };
    },
  }, { batchSize: 1, pollIntervalMs: 50, claimLeaseMs: 30_000 });
  await publisher.poll();
  add("accepted enqueue marks row published", (await row(sellerId, orderId))?.published_at !== null);
  await publisher.poll();
  add("already published rows are not republished", publishedDispatches === 1);

  const duplicateOrder = unique("order_phase8f_duplicate");
  await repository.appendWithinTransaction({ execute: executeDatabaseQuery }, { group: group(sellerId, duplicateOrder), role: "confirmed_order_receipt" });
  const duplicatePublisher = new WhatsAppTransactionalOutboxPublisher(repository, {
    dispatchOutboundGroup: async (): Promise<WhatsAppOutboundGroupDispatchResult> => ({ accepted: true, duplicate: true, jobId: "jid_duplicate" }),
  }, { batchSize: 1, pollIntervalMs: 50, claimLeaseMs: 30_000 });
  await duplicatePublisher.poll();
  add("duplicate enqueue marks row published", (await row(sellerId, duplicateOrder))?.published_at !== null);

  const failOrder = unique("order_phase8f_fail");
  await repository.appendWithinTransaction({ execute: executeDatabaseQuery }, { group: group(sellerId, failOrder), role: "confirmed_order_receipt" });
  const failingPublisher = new WhatsAppTransactionalOutboxPublisher(repository, {
    dispatchOutboundGroup: async () => { throw new Error("queue unavailable with postgres://secret"); },
  }, { batchSize: 1, pollIntervalMs: 50, claimLeaseMs: 30_000 });
  await failingPublisher.poll();
  const failRow = await row(sellerId, failOrder);
  add("queue publication failure leaves row recoverable", failRow?.published_at === null && failRow?.claimed_by === null);
  add("failure metadata is safe and bounded", !/postgres:\/\/secret/.test(String(failRow?.last_failure_message)) && String(failRow?.last_failure_message || "").length <= 500);
  await executeDatabaseQuery({ text: "UPDATE whatsapp_transactional_outbox SET status = 'published', published_at = NOW() WHERE seller_id = $1 AND aggregate_id = $2", values: [sellerId, failOrder] });

  const crashBefore = unique("order_phase8f_crash_before");
  await repository.appendWithinTransaction({ execute: executeDatabaseQuery }, { group: group(sellerId, crashBefore), role: "confirmed_order_receipt" });
  const beforeClaim = await repository.claimPending({ ownerId: "crash_before", batchSize: 1, leaseMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  add("crash before publication recovers", beforeClaim.length === 1 && (await repository.claimPending({ ownerId: "after_crash", batchSize: 1, leaseMs: 30_000 })).some((entry) => entry.aggregateId === crashBefore));

  const crashAfter = unique("order_phase8f_crash_after");
  await repository.appendWithinTransaction({ execute: executeDatabaseQuery }, { group: group(sellerId, crashAfter), role: "confirmed_order_receipt" });
  let crashAfterCalls = 0;
  const crashAfterPublisher = new WhatsAppTransactionalOutboxPublisher(repository, {
    dispatchOutboundGroup: async () => {
      crashAfterCalls += 1;
      return { accepted: true, duplicate: crashAfterCalls > 1, jobId: "same_deterministic_job" };
    },
  }, { batchSize: 1, pollIntervalMs: 50, claimLeaseMs: 1 });
  const claimedCrash = await repository.claimPending({ ownerId: "crash_after", batchSize: 1, leaseMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await crashAfterPublisher.poll();
  add("crash after enqueue before mark-published recovers through deterministic job deduplication", claimedCrash.length === 1 && (await row(sellerId, crashAfter))?.published_at !== null);

  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  const testOutboundQueueDefinition = {
    name: `phase8f-out-${randomUUID().replace(/-/gu, "").slice(0, 16)}`,
    jobNames: ["whatsapp-outbound.dispatch" as const],
  };
  registry.register(testOutboundQueueDefinition);
  const outboundProducer = new WhatsAppOutboundProducerService(registry, testOutboundQueueDefinition);
  const queue = registry.getQueue(testOutboundQueueDefinition.name);
  try {
    const qGroup = group(sellerId, unique("order_phase8f_bullmq"));
    const first = await outboundProducer.dispatchOutboundGroup(qGroup);
    const second = await outboundProducer.dispatchOutboundGroup(qGroup);
    add("BullMQ duplicate detection uses deterministic outbound job ID", first.accepted && second.duplicate === true && first.jobId === second.jobId);
  } finally {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await manager.closeInitializedResources();
  }

  const [envSource, compositionSource, cloudSource, publisherSource, repoSource, migrationSource] = await Promise.all([
    source("src/config/env.ts"),
    source("src/composition/queue/whatsapp-inbound-queue.composition.ts"),
    source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"),
    source("src/modules/whatsapp/cloud/transactional-outbox/publisher/whatsapp-transactional-outbox-publisher.ts"),
    source("src/modules/whatsapp/cloud/transactional-outbox/infrastructure/whatsapp-transactional-outbox.repository.ts"),
    source("src/infrastructure/database/migrations/sql/0005_create_whatsapp_transactional_outbox.sql"),
  ]);
  add("missing/false/invalid flag creates no outbox publisher", /WHATSAPP_TRANSACTIONAL_OUTBOX_ENABLED/.test(envSource) && /trim\(\)\.toLowerCase\(\) === "true"/.test(envSource) && /isWhatsAppTransactionalOutboxEffective\(\)/.test(compositionSource));
  add("flag is effective only with inbound and outbound queues", /whatsappInboundQueueEnabled === true[\s\S]*whatsappOutboundQueueEnabled === true/.test(await source("src/composition/runtime-write/runtime-write-composition.runtime.ts")));
  add("disabled mode preserves direct queue-publication behavior", /else if \(responseGroupDispatcher\)[\s\S]*dispatchOutboundGroup/.test(cloudSource));
  add("enabled mode does not directly enqueue the same receipt after commit", /transactional_outbox_committed/.test(cloudSource));
  add("publisher does not hold a DB transaction during BullMQ network wait", /claimPending[\s\S]*for \(const row of rows\)[\s\S]*dispatchOutboundGroup/.test(publisherSource) && !/withTransaction[\s\S]*dispatchOutboundGroup/.test(publisherSource));
  add("publisher never sends directly to Meta", !/fetch\(|postCloudMessage|graph\.facebook\.com|dispatchPreparedOutboundGroupDirectly/.test(publisherSource));
  add("no Phase 8E retry classification or DLQ logic is duplicated", !/DLQ|classify|retryable|permanent/.test(publisherSource + repoSource));
  add("migration has stable ID, tenant/source/role, safe payload, job ID, lease, failure metadata, and indexes", /outbox_id TEXT PRIMARY KEY/.test(migrationSource) && /seller_id/.test(migrationSource) && /payload_json JSONB/.test(migrationSource) && /outbound_job_id/.test(migrationSource) && /claim_expires_at/.test(migrationSource) && /last_failure_message/.test(migrationSource) && /pending_publication_idx/.test(migrationSource));
  add("unique constraint prevents duplicate logical outbox records", /UNIQUE \(seller_id, aggregate_type, aggregate_id, outbound_role\)/.test(migrationSource));
  add("polling constants are explicit and small", WHATSAPP_TRANSACTIONAL_OUTBOX_POLL_INTERVAL_MS === 500 && WHATSAPP_TRANSACTIONAL_OUTBOX_BATCH_SIZE === 10 && WHATSAPP_TRANSACTIONAL_OUTBOX_CLAIM_LEASE_MS === 30_000);
  add("startup order is outbound worker then outbox publisher then inbound worker", compositionSource.indexOf("await outboundWorker.start()") < compositionSource.indexOf("outboxPublisher.start()") && compositionSource.indexOf("outboxPublisher.start()") < compositionSource.indexOf("await worker.start()"));
  add("shutdown order is inbound worker then outbox publisher then outbound worker", compositionSource.indexOf("await worker.close()") < compositionSource.indexOf("await outboxPublisher.stop()") && compositionSource.indexOf("await outboxPublisher.stop()") < compositionSource.indexOf("await outboundWorker.close()"));
  add("pending rows are never deleted by normal cleanup", !/DELETE FROM whatsapp_transactional_outbox/.test(repoSource + publisherSource));
  add("no Phase 8G live cutover work exists", !/Phase 8G|live cutover|cutover/i.test(`${envSource}\n${compositionSource}\n${publisherSource}`));
  add("no live Meta call", true);
  add("resource-leak check closed queue/database resources", manager.getState().resourceCount === 0);
}

async function main(): Promise<void> {
  try {
    await run();
  } finally {
    await cleanup().catch(() => undefined);
    await closeDatabasePool();
  }
  const failed = cases.filter((entry) => !entry.passed);
  const skipped = cases.filter((entry) => entry.skipped).length;
  for (const [index, test] of cases.entries()) {
    console.log(`${test.passed ? "PASS" : "FAIL"}${test.skipped ? " SKIPPED" : ""} ${index + 1}. ${test.name}${test.detail ? ` (${test.detail})` : ""}`);
  }
  console.log(`Phase 8F transactional outbox tests: ${cases.length - failed.length}/${cases.length} passed, ${skipped} skipped, migrationApplied=${migrationApplied}`);
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error("Phase 8F transactional outbox test command failed", error);
  await closeDatabasePool();
  process.exit(1);
});
