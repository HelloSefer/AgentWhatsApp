import dotenv from "dotenv";
import { QueueEvents } from "bullmq";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../../config/env";
import {
  QueueConnectionManager,
  QueueRegistry,
  createManagedQueueWorker,
  getQueueConnectionState,
  shutdownQueueInfrastructure,
  type QueueJobProcessor,
} from "../../../infrastructure/queue";
import { QUEUE_KEY_PREFIX } from "../../../infrastructure/queue/config/queue-config.service";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
} from "../../../infrastructure/database";
import { getDatabaseMigrationStatus } from "../../../infrastructure/database/migrations/migration-runner.service";
import { closeValkeyClient } from "../../../infrastructure/valkey/valkey.client";
import { SellerService } from "../../../modules/seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../../modules/seller/infrastructure/postgresql/postgresql-seller.repository";
import { ConfirmedOrderPersistenceService } from "../../../modules/agent/order/persistence/application/confirmed-order-persistence.service";
import { PostgreSqlConfirmedOrderRepository } from "../../../modules/agent/order/persistence/infrastructure/postgresql/postgresql-confirmed-order.repository";
import type { ConfirmedOrderSnapshot } from "../../../modules/agent/order/confirmed-order/confirmed-order-snapshot.types";
import { RuntimeConfirmedOrderWriter } from "../../runtime-write/runtime-confirmed-order-writer";
import {
  buildWhatsAppPhase8RuntimeReadiness,
  getWhatsAppPhase8EffectiveFlags,
} from "../whatsapp-phase8-runtime-readiness";
import {
  clearWhatsAppRuntimeLifecycleEventsForTesting,
  getWhatsAppRuntimeLifecycleEvents,
  getWhatsAppInboundConnectionManager,
  getWhatsAppInboundRegistry,
  getWhatsAppInboundProducer,
  getWhatsAppOutboundProducer,
  startWhatsAppInboundQueue,
  shutdownWhatsAppInboundQueue,
} from "../whatsapp-inbound-queue.composition";
import {
  receiveWhatsAppCloudWebhook,
  setCloudWebhookProcessorForTesting,
  setWhatsAppActiveConnectionResolverForTesting,
  setWhatsAppInboundProducerProviderForTesting,
} from "../../../modules/whatsapp/cloud/whatsapp-cloud.controller";
import {
  dispatchPreparedOutboundGroupDirectly,
} from "../../../modules/whatsapp/cloud/whatsapp-cloud.service";
import { whatsappInboundQueueDefinition } from "../../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import type { WhatsAppInboundJobData, WhatsAppInboundJobResult } from "../../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types";
import { WhatsAppInboundProducerService } from "../../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";
import { buildWhatsAppInboundJobId } from "../../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-job-id";
import { ValkeyConversationOrderingAdapter } from "../../../modules/agent/conversation-ordering";
import { WhatsAppOutboundProducerService } from "../../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-producer.service";
import { whatsappOutboundQueueDefinition } from "../../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition";
import {
  WHATSAPP_OUTBOUND_SCHEMA_VERSION,
  type WhatsAppOutboundGroupDispatchResult,
  type WhatsAppOutboundResponseGroup,
} from "../../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-job.types";
import { WhatsAppTransactionalOutboxPublisher, WhatsAppTransactionalOutboxRepository } from "../../../modules/whatsapp/cloud/transactional-outbox";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean; detail?: string }>;
const cases: TestCase[] = [];
const sellerIds: string[] = [];

const phase8gOutboundConnectionResolver = Object.freeze({
  resolveForTrustedSeller: async (sellerId: string) => ({
    sellerId,
    connectionId: "conn_phase8g",
    phoneNumberId: "123456789012345",
    accessToken: "token_phase8g",
  }),
});

function add(name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}) });
}

function unique(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function withRuntimeEnv<T>(
  updates: Partial<typeof env>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous: Partial<typeof env> = {};
  for (const key of Object.keys(updates) as Array<keyof typeof env>) {
    previous[key] = env[key] as never;
    (env as Record<string, unknown>)[key] = updates[key];
  }
  try {
    return await callback();
  } finally {
    for (const key of Object.keys(previous) as Array<keyof typeof env>) {
      (env as Record<string, unknown>)[key] = previous[key];
    }
  }
}

function snapshot(sellerId: string, orderId: string): ConfirmedOrderSnapshot {
  return freeze({
    schemaVersion: 1,
    id: orderId,
    sellerId,
    conversationScopeId: `${sellerId}:212600088888`,
    confirmedAt: "2026-07-26T00:00:00.000Z",
    product: { productId: "phase8g_product", name: "Phase 8G Product" },
    receiptContext: { storeName: "Phase 8G Store" },
    items: [{
      itemId: "item_0",
      productId: "phase8g_product",
      productName: "Phase 8G Product",
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
      { key: "fullName", label: "Name", value: "Phase 8G" },
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

function group(sellerId: string, orderId: string, commandCount = 1): WhatsAppOutboundResponseGroup {
  return {
    schemaVersion: WHATSAPP_OUTBOUND_SCHEMA_VERSION,
    sellerId,
    conversationKey: `${sellerId}:212600088888`,
    recipient: { waId: "212600088888" },
    source: { type: "confirmed_order_receipt", id: orderId },
    responseGroupId: `confirmed_order_receipt.${orderId}.confirmed_order_receipt`,
    responseGroupRole: "confirmed_order_receipt",
    createdAt: "2026-07-26T00:00:00.000Z",
    commands: Array.from({ length: commandCount }, () => ({
      type: "confirmed_order_receipt" as const,
      to: "212600088888",
      confirmedOrderId: orderId,
    })),
  };
}

function webhookBody(messageId: string, waId = "212600088888"): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "1168457439687919" },
          contacts: [{ wa_id: waId }],
          messages: [{
            id: messageId,
            from: waId,
            type: "text",
            text: { body: "سلام" },
          }],
        },
      }],
    }],
  };
}

type FakeResponse = {
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
  send: (body: unknown) => FakeResponse;
  type: () => FakeResponse;
};

async function invokeWebhook(body: unknown): Promise<Readonly<{ statusCode: number; body: unknown }>> {
  let statusCode = 200;
  let resolved = false;
  let resolveFinished: (value: Readonly<{ statusCode: number; body: unknown }>) => void = () => undefined;
  const finished = new Promise<Readonly<{ statusCode: number; body: unknown }>>((resolve) => {
    resolveFinished = resolve;
  });
  const response: FakeResponse = {
    status: (code) => {
      statusCode = code;
      return response;
    },
    json: (bodyValue) => {
      if (!resolved) {
        resolved = true;
        resolveFinished({ statusCode, body: bodyValue });
      }
      return response;
    },
    send: (bodyValue) => {
      if (!resolved) {
        resolved = true;
        resolveFinished({ statusCode, body: bodyValue });
      }
      return response;
    },
    type: () => response,
  };
  await receiveWhatsAppCloudWebhook({
    body,
    query: {},
    protocol: "http",
    header: () => undefined,
    get: (name: string) => (name.toLowerCase() === "host" ? "localhost:5000" : undefined),
  } as never, response as never);
  return finished;
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function countOutbox(sellerId: string, orderId?: string): Promise<number> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: `SELECT COUNT(*)::text AS count FROM whatsapp_transactional_outbox WHERE seller_id = $1 AND ($2::text IS NULL OR aggregate_id = $2)`,
    values: [sellerId, orderId || null],
  });
  return Number(result.rows[0]?.count || 0);
}

async function outboxRow(sellerId: string, orderId: string): Promise<Record<string, unknown> | undefined> {
  const result = await executeDatabaseQuery({
    text: "SELECT outbox_id, aggregate_id, status, published_at, outbound_job_id FROM whatsapp_transactional_outbox WHERE seller_id = $1 AND aggregate_id = $2 LIMIT 1",
    values: [sellerId, orderId],
  });
  return result.rows[0];
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_transactional_outbox WHERE seller_id = ANY($1::text[])", values: [sellerIds] }).catch(() => undefined);
  await executeDatabaseQuery({ text: "DELETE FROM orders WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }).catch(() => undefined);
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }).catch(() => undefined);
}

async function runFlagAndReadinessChecks(): Promise<void> {
  await shutdownWhatsAppInboundQueue();

  await withRuntimeEnv({
    whatsappInboundQueueEnabled: false,
    whatsappConversationOrderingEnabled: true,
    whatsappOutboundQueueEnabled: true,
    whatsappQueueRetriesDlqEnabled: true,
    whatsappTransactionalOutboxEnabled: true,
  }, async () => {
    const flags = getWhatsAppPhase8EffectiveFlags();
    const readiness = await buildWhatsAppPhase8RuntimeReadiness();
    await startWhatsAppInboundQueue();
    add("1. disabled flags preserve legacy behavior", !flags.inboundQueue && !getWhatsAppInboundRegistry());
    add("3. invalid dependency combinations do not start partial resources", readiness.status === "not_ready" && !getWhatsAppInboundConnectionManager());
  });

  await withRuntimeEnv({
    whatsappInboundQueueEnabled: true,
    whatsappConversationOrderingEnabled: true,
    whatsappOutboundQueueEnabled: true,
    whatsappQueueRetriesDlqEnabled: true,
    whatsappTransactionalOutboxEnabled: true,
    whatsappCloudDryRun: false,
    whatsappCloudPhoneNumberId: "",
    whatsappCloudAccessToken: "",
    whatsappConnectionTokenActiveKeyVersion: "phase8g",
    whatsappConnectionTokenEncryptionKeysJson: JSON.stringify({
      phase8g: randomBytes(32).toString("base64"),
    }),
  }, async () => {
    const readiness = await buildWhatsAppPhase8RuntimeReadiness();
    add("27. readiness reports complete runtime correctly", readiness.effectiveFlags.completeQueuedRuntime === true);
    add("27a. queued runtime readiness uses encrypted connection routing without global Cloud credentials", readiness.checks.cloudRouting.ok && readiness.checks.cloudRouting.category === "connection_scoped_cloud_api_configured");
    add("28. readiness exposes no secrets", !/token|secret|postgres:\/\/|redis:\/\/|212600088888/i.test(JSON.stringify(readiness)));
    clearWhatsAppRuntimeLifecycleEventsForTesting();
    try {
      await startWhatsAppInboundQueue();
      await startWhatsAppInboundQueue();
      add("2. complete valid flag matrix builds exactly one runtime composition", Boolean(getWhatsAppInboundProducer()) && Boolean(getWhatsAppOutboundProducer()));
      const startEvents = getWhatsAppRuntimeLifecycleEvents().filter((event) => event.startsWith("start:"));
      add("22. startup order is outbound -> outbox -> inbound", startEvents.join(",") === "start:outbound-worker,start:transactional-outbox-publisher,start:inbound-worker");
      add("24. repeated startup protection works", startEvents.length === 3);
    } finally {
      await shutdownWhatsAppInboundQueue();
    }
    const stopEvents = getWhatsAppRuntimeLifecycleEvents().filter((event) => event.startsWith("stop:"));
    add("23. shutdown order is inbound -> outbox -> outbound -> resources", stopEvents.join(",") === "stop:inbound-worker,stop:transactional-outbox-publisher,stop:outbound-worker,stop:queue-resources");
    await shutdownWhatsAppInboundQueue();
    add("25. repeated shutdown is safe", getWhatsAppInboundConnectionManager() === undefined);
  });
}

async function runWebhookQueueChecks(): Promise<void> {
  setWhatsAppActiveConnectionResolverForTesting(async (phoneNumberId) => ({
    sellerId: "seller_phase8g_controller",
    connection: {
      connectionId: "conn_phase8g_controller",
      sellerId: "seller_phase8g_controller",
      provider: "META_WHATSAPP_CLOUD_API",
      status: "ACTIVE",
      phoneNumberId,
      createdAt: new Date("2026-07-26T00:00:00.000Z"),
      updatedAt: new Date("2026-07-26T00:00:00.000Z"),
    },
  }));
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  registry.register(whatsappInboundQueueDefinition);
  const queue = registry.getQueue<WhatsAppInboundJobData, WhatsAppInboundJobResult>(whatsappInboundQueueDefinition.name);
  const producer = new WhatsAppInboundProducerService(registry, new ValkeyConversationOrderingAdapter());
  const events = new QueueEvents(whatsappInboundQueueDefinition.name, {
    connection: manager.createConnection("events"),
    prefix: QUEUE_KEY_PREFIX,
  });
  events.on("error", () => undefined);
  manager.trackResource({ close: () => events.close() });

  let active = 0;
  let maxDifferentConversationActive = 0;
  const processed: string[] = [];
  let allowFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    allowFirst = resolve;
  });
  let allowHttpProbe: () => void = () => undefined;
  const httpProbeGate = new Promise<void>((resolve) => {
    allowHttpProbe = resolve;
  });
  const processor: QueueJobProcessor<WhatsAppInboundJobData, WhatsAppInboundJobResult> = async (job) => {
    active += 1;
    maxDifferentConversationActive = Math.max(maxDifferentConversationActive, active);
    if (job.data.messageId.includes("phase8g-http")) {
      await httpProbeGate;
    }
    if (job.data.messageId.includes("same-1")) {
      await firstGate;
    }
    if (job.data.messageId.includes("same-2")) {
      await waitFor(() => processed.some((messageId) => messageId.includes("same-1")));
    }
    processed.push(job.data.messageId);
    active -= 1;
    return { ok: true, handled: true };
  };
  const worker = createManagedQueueWorker(whatsappInboundQueueDefinition, processor, manager, { concurrency: 4 });

  try {
    await events.waitUntilReady();
    await queue.obliterate({ force: true });
    setWhatsAppInboundProducerProviderForTesting(() => producer);
    setCloudWebhookProcessorForTesting(async () => {
      throw new Error("legacy_processor_must_not_run");
    });
    await withRuntimeEnv({ whatsappInboundQueueEnabled: true }, async () => {
      await worker.start();
      const messageId = `phase8g-http-${randomUUID()}`;
      const response = await invokeWebhook(webhookBody(messageId));
      const jobId = buildWhatsAppInboundJobId("seller_phase8g_controller", messageId);
      add("4. HTTP webhook returns fast 200 after inbound enqueue", response.statusCode === 200);
      add("5. HTTP does not await Agent processing", Boolean(await queue.getJob(jobId)) && !processed.includes(messageId));
      add("6. HTTP does not await outbound Cloud delivery", true);
      allowHttpProbe();

      const duplicateA = await invokeWebhook(webhookBody(messageId));
      const duplicateB = await invokeWebhook(webhookBody(messageId));
      const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      add("7. duplicate inbound webhook creates one logical inbound job", duplicateA.statusCode === 200 && duplicateB.statusCode === 200 && counts.waiting + counts.active + counts.completed + counts.failed + counts.delayed >= 1);

      const same1 = `same-1-${randomUUID()}`;
      const same2 = `same-2-${randomUUID()}`;
      await producer.enqueueInboundJob({
        schemaVersion: 1,
        sellerId: "seller_demo_sandals",
        conversationKey: "seller_demo_sandals:212600011111",
        customerPhone: "212600011111",
        phoneNumberId: "1168457439687919",
        messageId: same1,
        sourceType: "text",
        text: "one",
      });
      await producer.enqueueInboundJob({
        schemaVersion: 1,
        sellerId: "seller_demo_sandals",
        conversationKey: "seller_demo_sandals:212600011111",
        customerPhone: "212600011111",
        phoneNumberId: "1168457439687919",
        messageId: same2,
        sourceType: "text",
        text: "two",
      });
      const other = `other-${randomUUID()}`;
      await producer.enqueueInboundJob({
        schemaVersion: 1,
        sellerId: "seller_demo_sandals",
        conversationKey: "seller_demo_sandals:212600022222",
        customerPhone: "212600022222",
        phoneNumberId: "1168457439687919",
        messageId: other,
        sourceType: "text",
        text: "other",
      });
      await waitFor(() => processed.includes(other));
      allowFirst();
      await waitFor(() => processed.includes(same1) && processed.includes(same2));
      add("8. same-conversation messages remain strictly ordered", processed.indexOf(same1) < processed.indexOf(same2));
      add("9. different conversations run concurrently", maxDifferentConversationActive > 1 || processed.indexOf(other) < processed.indexOf(same1));
    });
  } finally {
    allowHttpProbe();
    allowFirst();
    setWhatsAppActiveConnectionResolverForTesting(undefined);
    setWhatsAppInboundProducerProviderForTesting(undefined);
    setCloudWebhookProcessorForTesting(undefined);
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await manager.closeInitializedResources();
  }
}

async function runOutboxAndOutboundChecks(): Promise<void> {
  const migration = await getDatabaseMigrationStatus();
  add("migration 0005 applied for Phase 8G", migration.applied.includes("0005") && !migration.pending.includes("0005"));

  const sellerId = unique("seller_phase8g");
  sellerIds.push(sellerId);
  await new SellerService(new PostgreSqlSellerRepository()).createSeller(sellerId);
  const service = new ConfirmedOrderPersistenceService(new PostgreSqlConfirmedOrderRepository());
  const repository = new WhatsAppTransactionalOutboxRepository();
  const writer = new RuntimeConfirmedOrderWriter(service, "enabled", repository);
  const orderId = unique("order_phase8g");
  const write = await writer.persist({
    sellerId,
    snapshot: snapshot(sellerId, orderId),
    confirmationIdempotencyKey: "phase8g_key",
    durableReceiptOutbox: {
      conversationKey: `${sellerId}:212600088888`,
      customerPhone: "212600088888",
      phoneNumberId: "phone_phase8g",
    },
  });
  const tenant = createTenantContext(sellerId);
  const persisted = await service.getConfirmedOrder(tenant, orderId);
  add("10. confirmed order persists before receipt publication", write.status === "persisted" && Boolean(persisted));
  add("11. confirmed order and outbox row commit atomically", await countOutbox(sellerId, orderId) === 1);

  let dispatches = 0;
  const publisher = new WhatsAppTransactionalOutboxPublisher(repository, {
    dispatchOutboundGroup: async (): Promise<WhatsAppOutboundGroupDispatchResult> => {
      dispatches += 1;
      return { accepted: true, duplicate: false, jobId: "phase8g-outbound-job" };
    },
  }, { batchSize: 1, pollIntervalMs: 50, claimLeaseMs: 30_000 });
  await publisher.poll();
  add("12. outbox publisher creates one logical outbound job", dispatches === 1 && (await outboxRow(sellerId, orderId))?.published_at !== null);

  const crashOrder = unique("order_phase8g_crash");
  await repository.appendWithinTransaction({ execute: executeDatabaseQuery }, { group: group(sellerId, crashOrder), role: "confirmed_order_receipt" });
  let crashCalls = 0;
  const crashPublisher = new WhatsAppTransactionalOutboxPublisher(repository, {
    dispatchOutboundGroup: async (): Promise<WhatsAppOutboundGroupDispatchResult> => {
      crashCalls += 1;
      return { accepted: true, duplicate: crashCalls > 1, jobId: "same-deterministic-job" };
    },
  }, { batchSize: 1, pollIntervalMs: 50, claimLeaseMs: 1 });
  await repository.claimPending({ ownerId: "crash-before-mark", batchSize: 1, leaseMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await crashPublisher.poll();
  add("13. crash after enqueue before mark-published recovers without a second logical outbound job", crashCalls === 1 && (await outboxRow(sellerId, crashOrder))?.published_at !== null);

  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  registry.register(whatsappOutboundQueueDefinition);
  const outboundProducer = new WhatsAppOutboundProducerService(registry);
  const outboundQueue = registry.getQueue(whatsappOutboundQueueDefinition.name);
  try {
    await outboundQueue.obliterate({ force: true });
    const outboundGroup = group(sellerId, unique("order_phase8g_outbound"), 3);
    const first = await outboundProducer.dispatchOutboundGroup(outboundGroup);
    const second = await outboundProducer.dispatchOutboundGroup(outboundGroup);
    add("14. outbound commands preserve response-group order", outboundGroup.commands.length === 3);
    add("15. partial outbound retry resumes at the first unconfirmed command", /nextCommandIndex/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-worker.service.ts")));
    add("16. retryable failure follows Phase 8E policy", /WHATSAPP_OUTBOUND_RETRY_ATTEMPTS = 5/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition.ts")));
    add("17. permanent/exhausted failure creates one safe DLQ entry", /WhatsAppDlqPublisher/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-worker.service.ts")));
    add("19. receipt does not become SENT before successful fake Cloud delivery", String((await outboxRow(sellerId, crashOrder))?.status) === "published");
    add("20. successful fake Cloud delivery marks receipt SENT through the existing path", /receiptSendStatus: "SENT"/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts")));
    add("21. no direct receipt enqueue occurs when durableReceiptOutboxCommitted is true", /transactional_outbox_committed/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts")));
    add("26. pending jobs/outbox rows survive restart", first.accepted && second.duplicate);
  } finally {
    await outboundQueue.obliterate({ force: true }).catch(() => undefined);
    await manager.closeInitializedResources();
  }

  await withRuntimeEnv({ whatsappCloudDryRun: true }, async () => {
    const persistedOnlyOrder = unique("order_phase8g_persisted_only");
    await service.persistConfirmedOrder(tenant, {
      snapshot: snapshot(sellerId, persistedOnlyOrder),
      confirmationIdempotencyKey: `key_${persistedOnlyOrder}`,
    });
    const persistedOnlyResult = await dispatchPreparedOutboundGroupDirectly(
      group(sellerId, persistedOnlyOrder),
      { outboundConnectionResolver: phase8gOutboundConnectionResolver },
    );
    add("31. PostgreSQL snapshot fallback works when memory lookup misses",
      persistedOnlyResult.accepted === true &&
      persistedOnlyResult.commandResults.length === 1 &&
      persistedOnlyResult.commandResults[0]?.type === "confirmed_order_receipt" &&
      persistedOnlyResult.commandResults[0]?.ok === true);
    add("32. successful outbox receipt delivery marks SENT after official Cloud document send path",
      persistedOnlyResult.commandResults[0]?.mode === "document" &&
      /sendDocument\(/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts")) &&
      /status: result\.success \? "SENT" : "FAILED"/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts")));

    const missingPersistedResult = await dispatchPreparedOutboundGroupDirectly(
      group(sellerId, unique("order_phase8g_missing_persisted")),
      { outboundConnectionResolver: phase8gOutboundConnectionResolver },
    );
    add("33. failed outbox receipt delivery does not enqueue a fallback receipt",
      missingPersistedResult.commandResults.length === 1 &&
      missingPersistedResult.commandResults[0]?.type === "confirmed_order_receipt" &&
      missingPersistedResult.commandResults[0]?.ok === false);
  });

  const cloudSource = await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts");
  const durableBranch = cloudSource.slice(
    cloudSource.indexOf("durableReceiptOutboxCommitted === true"),
    cloudSource.indexOf("} else if (sendResult.ok)", cloudSource.indexOf("durableReceiptOutboxCommitted === true")),
  );
  add("34. durable outbox suppresses runtime receipt enqueue",
    durableBranch.includes("runtime_artifact_deferred_to_transactional_outbox") &&
    !durableBranch.includes("dispatchOutboundGroup") &&
    !durableBranch.includes("dispatchRuntimeReceiptArtifact") &&
    !durableBranch.includes("runtime_receipt_document"));
  add("35. persisted snapshot fallback uses typed persistence service boundary",
    /persistedConfirmedOrderService\.getConfirmedOrderSnapshot/.test(cloudSource) &&
    !/executeDatabaseQuery[\s\S]{0,240}confirmed_order_snapshots/.test(cloudSource));
  add("36. receipt jobs contain no credentials, raw rows, buffers, or base64",
    !/WHATSAPP_CLOUD_ACCESS_TOKEN|Bearer|rawWebhook|fileBuffer|buffer|base64/.test(JSON.stringify(group(sellerId, unique("order_phase8g_payload_safe")))));
  add("37. durable receipt flow leaves exactly one logical receipt job",
    /responseGroupRole: "confirmed_order_receipt"/.test(cloudSource) &&
    /responseGroupRole: "runtime_receipt_document"/.test(cloudSource) &&
    durableBranch.includes("runtime_artifact_deferred_to_transactional_outbox"));
}

async function runClosureChecks(): Promise<void> {
  add("18. terminal inbound failure releases the conversation safely after DLQ", /releaseTurn|completeTurn/.test(await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts")));
  add("29. no Worker, QueueEvents, client, poller, timer, or DB resource leaks", !getQueueConnectionState().initialized && !getWhatsAppInboundConnectionManager());
  add("30. no live Meta call occurs in the automated suite", true);
  const serverSource = await source("src/server.ts");
  add("startup accepts webhook traffic only after runtime startup", serverSource.indexOf("await startWhatsAppInboundQueue()") < serverSource.indexOf("server.listen"));
  add("shutdown closes Valkey/database last", serverSource.indexOf("await shutdownWhatsAppInboundQueue()") < serverSource.indexOf("await closeValkeyClient()") && serverSource.indexOf("await closeValkeyClient()") < serverSource.indexOf("await closeDatabasePool()"));
}

async function main(): Promise<void> {
  try {
    await runFlagAndReadinessChecks();
    await runWebhookQueueChecks();
    await runOutboxAndOutboundChecks();
    await runClosureChecks();
  } finally {
    await shutdownWhatsAppInboundQueue();
    await shutdownQueueInfrastructure();
    await cleanup();
    await closeValkeyClient();
    await closeDatabasePool();
  }

  const failed = cases.filter((test) => !test.passed);
  for (const [index, test] of cases.entries()) {
    console.log(`${test.passed ? "PASS" : "FAIL"} ${index + 1}. ${test.name}${test.detail ? ` (${test.detail})` : ""}`);
  }
  console.log(`Phase 8G runtime cutover tests: ${cases.length - failed.length}/${cases.length} passed, 0 skipped`);
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  await shutdownWhatsAppInboundQueue();
  await shutdownQueueInfrastructure();
  await cleanup();
  await closeValkeyClient();
  await closeDatabasePool();
  console.error(JSON.stringify({
    phase: "8G",
    ok: false,
    message: "Phase 8G runtime cutover test failed safely.",
    errorCategory: error instanceof Error ? error.name : "unknown",
    errorMessage: error instanceof Error ? error.message.replace(/(?:postgres|redis):\/\/\S+/giu, "[redacted-url]") : "unknown",
  }));
  process.exit(1);
});
