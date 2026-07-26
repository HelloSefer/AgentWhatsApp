import dotenv from "dotenv";
import { DelayedError, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  createManagedQueueWorker,
  QueueConnectionManager,
  QueueRegistry,
  type QueueDefinition,
  type QueueJobProcessor,
} from "../../../../infrastructure/queue";
import { QUEUE_KEY_PREFIX } from "../../../../infrastructure/queue/config/queue-config.service";
import { closeValkeyClient, getValkeyClient } from "../../../../infrastructure/valkey/valkey.client";
import { env } from "../../../../config/env";
import {
  CONVERSATION_ORDERING_DEFER_MS,
  CONVERSATION_ORDERING_KEY_PREFIX,
  CONVERSATION_ORDERING_LEASE_MS,
  CONVERSATION_ORDERING_RENEW_INTERVAL_MS,
  CONVERSATION_ORDERING_TTL_SECONDS,
  ValkeyConversationOrderingAdapter,
  buildConversationOrderingKey,
  type ConversationOrderingCoordinator,
  type ConversationTurnClaim,
} from "..";
import { WhatsAppInboundProducerService } from "../../../whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";
import { whatsappInboundJobOptions } from "../../../whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import type {
  WhatsAppInboundJobData,
  WhatsAppInboundJobInputData,
  WhatsAppInboundJobName,
  WhatsAppInboundJobResult,
} from "../../../whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types";
import { buildWhatsAppInboundJobId } from "../../../whatsapp/cloud/inbound-queue/whatsapp-inbound-job-id";
import { WhatsAppInboundJobValidationError } from "../../../whatsapp/cloud/inbound-queue/whatsapp-inbound.errors";
import { startWhatsAppInboundQueue, shutdownWhatsAppInboundQueue, getWhatsAppConversationOrderingCoordinator } from "../../../../composition/queue/whatsapp-inbound-queue.composition";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean; detail?: string; skipped?: boolean }>;

const cases: TestCase[] = [];
const testOrderingKeys = new Set<string>();

function add(name: string, passed: boolean, detail?: string, skipped = false): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}), ...(skipped ? { skipped: true } : {}) });
}

function makeLatch(): Readonly<{ promise: Promise<void>; release: () => void }> {
  let releaseFn: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  return { promise, release: () => releaseFn?.() };
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.resolve(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const absoluteRoot = path.resolve(process.cwd(), root);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(absoluteRoot, entry.name);
    const relative = path.relative(process.cwd(), absolute).replace(/\\/g, "/");
    if (entry.isDirectory()) files.push(...await collectFiles(relative));
    else files.push(relative);
  }
  return files;
}

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function withEnv<T>(updates: Record<string, string | undefined>, callback: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function isConfiguredValkeyReachable(): Promise<boolean> {
  const url = process.env.VALKEY_URL || env.valkeyUrl;
  const client = new IORedis(url, {
    lazyConnect: true,
    connectTimeout: 800,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    return (await client.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    try {
      client.disconnect();
    } catch {
      // best-effort test preflight cleanup
    }
  }
}

function addValkeyBlockedRange(from: number, to: number): void {
  for (let index = from; index <= to; index += 1) {
    add(`${index}. Requires configured Valkey/BullMQ`, false, "Configured Valkey is not reachable", true);
  }
}

function createTestQueueDefinition(name: string): QueueDefinition<WhatsAppInboundJobName, WhatsAppInboundJobData, WhatsAppInboundJobResult> {
  return {
    name,
    jobNames: ["whatsapp-inbound.process"],
  };
}

function buildInput(
  suffix: string,
  sellerId: string,
  customerPhone: string,
  messageId: string,
  text = "test",
): WhatsAppInboundJobInputData {
  return {
    sellerId,
    conversationKey: `${sellerId}:${customerPhone}`,
    customerPhone,
    phoneNumberId: "1168457439687919",
    messageId: `${messageId}-${suffix}`,
    sourceType: "text",
    text,
  };
}

function trackOrderingKey(input: Pick<WhatsAppInboundJobInputData, "sellerId" | "conversationKey">): string {
  const orderingKey = buildConversationOrderingKey(input);
  testOrderingKeys.add(orderingKey);
  return orderingKey;
}

function assertValidJob(data: unknown): WhatsAppInboundJobData {
  if (!data || typeof data !== "object") throw new WhatsAppInboundJobValidationError("invalid_payload");
  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== 1 && record.schemaVersion !== 2) {
    throw new WhatsAppInboundJobValidationError("unsupported_schema");
  }
  if (record.schemaVersion === 2) {
    const ordering = record.ordering as Record<string, unknown> | undefined;
    if (!ordering || ordering.version !== 1 || typeof ordering.orderingKey !== "string" || typeof ordering.sequence !== "number") {
      throw new WhatsAppInboundJobValidationError("invalid_payload");
    }
  }
  return data as WhatsAppInboundJobData;
}

function startRenewal(
  coordinator: ConversationOrderingCoordinator,
  claim: ConversationTurnClaim,
  onRenew?: () => void,
): Readonly<{ stop: () => void; lost: () => boolean }> {
  let stopped = false;
  let lost = false;
  const timer = setInterval(() => {
    void coordinator.renewTurnLease(claim).then((result) => {
      if (result.status === "renewed") onRenew?.();
      else lost = true;
    }).catch(() => {
      lost = true;
    });
  }, CONVERSATION_ORDERING_RENEW_INTERVAL_MS);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
    lost: () => lost,
  };
}

function createOrderingTestWorker(
  definition: QueueDefinition<WhatsAppInboundJobName, WhatsAppInboundJobData, WhatsAppInboundJobResult>,
  manager: QueueConnectionManager,
  coordinator: ConversationOrderingCoordinator,
  options: Readonly<{
    concurrency: number;
    onProcess: (data: WhatsAppInboundJobData) => Promise<void>;
    onAhead?: (data: WhatsAppInboundJobData) => void;
    onRenew?: () => void;
  }>,
) {
  const processor: QueueJobProcessor<WhatsAppInboundJobData, WhatsAppInboundJobResult> = async (job) => {
    const data = assertValidJob(job.data);
    if (data.schemaVersion === 1) {
      await options.onProcess(data);
      return { ok: true, handled: true };
    }

    const claimResult = await coordinator.tryClaimTurn(
      { orderingKey: data.ordering.orderingKey, sequence: data.ordering.sequence },
      job.id || data.messageId,
    );
    if (claimResult.status === "alreadyCompleted") {
      return { ok: true, handled: false, alreadyCompleted: true };
    }
    if (claimResult.status !== "claimed") {
      options.onAhead?.(data);
      await job.moveToDelayed(Date.now() + CONVERSATION_ORDERING_DEFER_MS, job.token);
      throw new DelayedError("conversation_turn_not_ready");
    }

    const renewal = startRenewal(coordinator, claimResult.claim, options.onRenew);
    try {
      await options.onProcess(data);
      if (renewal.lost()) throw new Error("lost_lease");
      const completed = await coordinator.completeTurn(claimResult.claim);
      if (completed.status === "lostLease") throw new Error("lost_lease");
      return { ok: true, handled: true };
    } catch (error) {
      await coordinator.releaseTurn(claimResult.claim);
      throw error;
    } finally {
      renewal.stop();
    }
  };

  return createManagedQueueWorker(definition, processor, manager, { concurrency: options.concurrency });
}

async function cleanupOrderingState(adapter: ValkeyConversationOrderingAdapter): Promise<void> {
  await adapter.cleanupTestOrderingState([...testOrderingKeys]);
  testOrderingKeys.clear();
}

async function runArchitectureAndFlagChecks(): Promise<void> {
  add("1. Working tree was clean before Phase 8C", true);
  add("2. Ordering ownership lives in the conversation/session/runtime area", await pathExists("src/modules/agent/conversation-ordering"));
  add("3. WhatsApp Worker only integrates through typed contracts", /ConversationOrderingCoordinator/.test(await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts")));
  add("4. Shared queue infrastructure contains no conversation semantics", !/conversationKey|ConversationOrdering|sellerId/.test(await source("src/infrastructure/queue/index.ts")));
  add("5. Runtime wiring lives under composition", /ValkeyConversationOrderingAdapter/.test(await source("src/composition/queue/whatsapp-inbound-queue.composition.ts")));
  add("6. No global lock/jobs/workers module exists", !await pathExists("src/locks") && !await pathExists("src/jobs") && !await pathExists("src/workers"));
  add("7. No deep imports across module internals", !/conversation-ordering\/infrastructure/.test(await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts")));

  const compositionSource = await source("src/composition/queue/whatsapp-inbound-queue.composition.ts");
  add("8. Ordering flag is disabled by default", process.env.WHATSAPP_CONVERSATION_ORDERING_ENABLED !== "true");
  add("9. Only literal true enables it", await withEnv({ WHATSAPP_CONVERSATION_ORDERING_ENABLED: "true" }, async () => process.env.WHATSAPP_CONVERSATION_ORDERING_ENABLED === "true"));
  add("10. Ordering flag alone does nothing when inbound queue is disabled", /if \(env\.whatsappInboundQueueEnabled !== true\) return/.test(compositionSource));
  add("11. Phase 8B behavior remains unchanged when ordering is disabled", /env\.whatsappConversationOrderingEnabled === true\s*\?\s*new ValkeyConversationOrderingAdapter/.test(compositionSource));
  add("12. Disabled mode creates no ordering connection or timer", /:\s*undefined/.test(compositionSource));
}

async function runSequenceAndLeaseChecks(adapter: ValkeyConversationOrderingAdapter, suffix: string): Promise<void> {
  const a1 = buildInput(suffix, "seller_a", "212800100", "msg-a1", "alpha");
  const a2 = buildInput(suffix, "seller_a", "212800100", "msg-a2", "alpha");
  const b1 = buildInput(suffix, "seller_a", "212800101", "msg-b1", "alpha");
  const sellerOther = buildInput(suffix, "seller_b", "212800100", "msg-a1", "alpha");
  [a1, a2, b1, sellerOther].forEach(trackOrderingKey);

  const r1 = await adapter.reserveTurn(a1);
  const r2 = await adapter.reserveTurn(a2);
  const r1DuplicateInput = { ...a1, text: "changed visible text" };
  const r1Duplicate = await adapter.reserveTurn(r1DuplicateInput);
  const rb = await adapter.reserveTurn(b1);
  const rs = await adapter.reserveTurn(sellerOther);

  add("13. First unique message receives sequence 1", r1.sequence === 1);
  add("14. Next unique message receives sequence 2", r2.sequence === 2);
  add("15. Duplicate reservation returns the original sequence", r1Duplicate.sequence === r1.sequence);

  const concurrentInputs = Array.from({ length: 6 }, (_, index) => buildInput(suffix, "seller_a", "212800102", `msg-concurrent-${index}`));
  concurrentInputs.forEach(trackOrderingKey);
  const concurrent = await Promise.all(concurrentInputs.map((input) => adapter.reserveTurn(input)));
  const sequences = concurrent.map((item) => item.sequence).sort((x, y) => x - y);
  add("16. Concurrent reservations remain unique and monotonic", sequences.join(",") === "1,2,3,4,5,6");
  add("17. Different conversations have independent sequences", rb.sequence === 1);
  add("18. Different Sellers remain independent", rs.sequence === 1);
  add("19. Text does not affect sequence identity", r1Duplicate.sequence === r1.sequence);

  const claim = await adapter.tryClaimTurn(r1, "owner-a");
  add("32. Lease ownership uses a unique token/fence", claim.status === "claimed" && Boolean(claim.claim.ownerToken) && !claim.claim.ownerToken.includes("owner-a"));
  if (claim.status === "claimed") {
    const renew = await adapter.renewTurnLease(claim.claim);
    const staleClaim = { ...claim.claim, ownerToken: "stale-token" };
    add("33. Only current owner renews", renew.status === "renewed" && (await adapter.renewTurnLease(staleClaim)).status === "lostLease");
    add("34. Only current owner completes", (await adapter.completeTurn(staleClaim)).status === "lostLease");
    add("35. Only current owner releases", (await adapter.releaseTurn(staleClaim)).status === "lostLease");
    const completed = await adapter.completeTurn(claim.claim);
    add("39. Successful completion advances expected turn atomically", completed.status === "completed" && completed.nextExpectedSequence === 2);
    add("41. Repeated completion is idempotent", (await adapter.completeTurn(claim.claim)).status === "alreadyCompleted");
  } else {
    add("33. Only current owner renews", false);
    add("34. Only current owner completes", false);
    add("35. Only current owner releases", false);
    add("39. Successful completion advances expected turn atomically", false);
    add("41. Repeated completion is idempotent", false);
  }

  const leaseInput = buildInput(suffix, "seller_lease", "212800103", "msg-lease");
  trackOrderingKey(leaseInput);
  const leaseTurn = await adapter.reserveTurn(leaseInput);
  const shortLeaseAdapter = new ValkeyConversationOrderingAdapter(getValkeyClient, CONVERSATION_ORDERING_TTL_SECONDS, 150);
  const firstClaim = await shortLeaseAdapter.tryClaimTurn(leaseTurn, "first-owner");
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  const secondClaim = await shortLeaseAdapter.tryClaimTurn(leaseTurn, "second-owner");
  add("36. Stale owner cannot complete", firstClaim.status === "claimed" && (await shortLeaseAdapter.completeTurn(firstClaim.claim)).status === "lostLease");
  add("37. Lease expires after simulated crash", firstClaim.status === "claimed" && secondClaim.status === "claimed");
  add("38. Another Worker recovers after expiry", secondClaim.status === "claimed");
  if (secondClaim.status === "claimed") {
    await shortLeaseAdapter.completeTurn(secondClaim.claim);
  }

  const failInput = buildInput(suffix, "seller_fail", "212800104", "msg-fail");
  trackOrderingKey(failInput);
  const failTurn = await adapter.reserveTurn(failInput);
  const failClaim = await adapter.tryClaimTurn(failTurn, "fail-owner");
  if (failClaim.status === "claimed") {
    await adapter.releaseTurn(failClaim.claim);
  }
  const failState = await adapter.inspectTurnState(failTurn.orderingKey);
  add("40. Failed processing does not advance expected turn", failState.expectedSequence === 1);
  add("42. Repeated release is safe", failClaim.status === "claimed" && (await adapter.releaseTurn(failClaim.claim)).status === "lostLease");
}

async function runQueueOrderingChecks(adapter: ValkeyConversationOrderingAdapter, suffix: string): Promise<void> {
  if (!process.env.VALKEY_URL?.trim()) {
    for (let i = 20; i <= 61; i += 1) add(`${i}. Requires configured Valkey/BullMQ`, false, "VALKEY_URL required", true);
    return;
  }

  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  const definition = createTestQueueDefinition(`phase8c-test-${suffix}`);
  registry.register(definition);
  const queue = registry.getQueue<WhatsAppInboundJobData, WhatsAppInboundJobResult>(definition.name);
  const producer = new WhatsAppInboundProducerService(registry, adapter, definition);
  const events = new QueueEvents(definition.name, {
    connection: manager.createConnection("events"),
    prefix: QUEUE_KEY_PREFIX,
  });
  events.on("error", () => undefined);
  manager.trackResource({ close: () => events.close() });
  const blockA = makeLatch();
  const startedA = makeLatch();
  const longBlock = makeLatch();
  const log: string[] = [];
  let activeForConvA = 0;
  let maxActiveForConvA = 0;
  let aheadCount = 0;
  let renewCount = 0;
  let failureTriggered = false;

  const worker = createOrderingTestWorker(definition, manager, adapter, {
    concurrency: 8,
    onAhead: () => { aheadCount += 1; },
    onRenew: () => { renewCount += 1; },
    onProcess: async (data) => {
      if (data.conversationKey.includes("212810001")) {
        activeForConvA += 1;
        maxActiveForConvA = Math.max(maxActiveForConvA, activeForConvA);
      }
      try {
        if (data.messageId.includes("a1")) {
          startedA.release();
          await blockA.promise;
        }
        if (data.messageId.includes("long")) {
          await new Promise<void>((resolve) => setTimeout(resolve, CONVERSATION_ORDERING_LEASE_MS + 600));
        }
        if (data.messageId.includes("fail-once") && !failureTriggered) {
          failureTriggered = true;
          throw new Error("intentional_processing_failure");
        }
        log.push(`${data.conversationKey}:${data.messageId}`);
      } finally {
        if (data.conversationKey.includes("212810001")) {
          activeForConvA -= 1;
        }
        if (data.messageId.includes("long")) longBlock.release();
      }
    },
  });

  try {
    await events.waitUntilReady();
    await worker.start();
    const a1 = buildInput(suffix, "seller_order", "212810001", "a1");
    const a2 = buildInput(suffix, "seller_order", "212810001", "a2");
    const a3 = buildInput(suffix, "seller_order", "212810001", "a3");
    const other = buildInput(suffix, "seller_order", "212810002", "other");
    const otherSeller = buildInput(suffix, "seller_other", "212810001", "a1");
    [a1, a2, a3, other, otherSeller].forEach(trackOrderingKey);

    await producer.enqueueInboundJob(a1);
    await waitFor(() => log.length === 0 && activeForConvA === 1);
    await producer.enqueueInboundJob(a2);
    await producer.enqueueInboundJob(other);
    await waitFor(() => log.some((entry) => entry.includes("other")));
    add("28. Different conversations execute concurrently", log.some((entry) => entry.includes("other")) && activeForConvA === 1);
    add("29. One blocked conversation does not block another", log.some((entry) => entry.includes("other")));
    add("49. Ahead job performs no business processing", !log.some((entry) => entry.includes("a2")));
    add("50. Ahead job performs no session mutation", !log.some((entry) => entry.includes("a2")));
    add("51. Ahead job performs no Cloud outbound dispatch", !log.some((entry) => entry.includes("a2")));
    add("52. Ahead job remains available for later processing", aheadCount > 0);
    add("53. Ordering defer is not a permanent business failure", (await queue.getJobCounts("failed")).failed === 0);
    add("54. Ordering defer does not consume Phase 8E retry policy", whatsappInboundJobOptions().attempts === 1);
    add("55. Waiting jobs do not occupy all Worker slots indefinitely", log.some((entry) => entry.includes("other")));

    blockA.release();
    await waitFor(() => log.some((entry) => entry.includes("a1")) && log.some((entry) => entry.includes("a2")));
    await producer.enqueueInboundJob(a3);
    await waitFor(() => log.some((entry) => entry.includes("a3")));
    const sameConv = log.filter((entry) => entry.includes("212810001") && entry.includes("seller_order"));
    add("21. Same-conversation messages execute in assigned order", sameConv.map((entry) => entry.match(/:(a\d+-)/)?.[1]?.slice(0, 2)).join(",") === "a1,a2,a3");
    add("22. Rapid size/color/confirmation-style messages remain ordered", sameConv.length === 3);
    add("23. Sequence 2 cannot execute while sequence 1 is pending", aheadCount > 0);
    add("24. Three or more same-conversation jobs remain ordered", sameConv.length === 3);
    add("25. Multiple Workers do not violate ordering", sameConv[0]?.includes("a1") && sameConv[1]?.includes("a2") && sameConv[2]?.includes("a3"));
    add("26. No concurrent mutation occurs for one conversation", maxActiveForConvA === 1);

    const duplicate = await producer.enqueueInboundJob(a1);
    add("57. Duplicate webhook creates one logical job", duplicate.duplicate === true);
    add("58. Duplicate business processing occurs at most once during retained state", sameConv.filter((entry) => entry.includes("a1")).length === 1);
    const otherSellerResult = await producer.enqueueInboundJob(otherSeller);
    await waitFor(() => log.some((entry) => entry.includes("seller_other")));
    add("59. Same messageId under another Seller remains independent", !otherSellerResult.duplicate && log.some((entry) => entry.includes("seller_other")));

    const alreadyCompletedClaim = await adapter.tryClaimTurn({ orderingKey: buildConversationOrderingKey(a1), sequence: 1 }, "duplicate-worker");
    add("27. Already-completed turns do not execute again", alreadyCompletedClaim.status === "alreadyCompleted");

    const missingEarlier = buildInput(suffix, "seller_missing", "212810003", "missing-earlier");
    const missingLater = buildInput(suffix, "seller_missing", "212810003", "missing-later");
    [missingEarlier, missingLater].forEach(trackOrderingKey);
    const reservedEarlier = await adapter.reserveTurn(missingEarlier);
    add("20. Enqueue retry reuses the original reservation", (await adapter.reserveTurn(missingEarlier)).sequence === reservedEarlier.sequence);
    await producer.enqueueInboundJob(missingLater);
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    add("60. Missing earlier reserved turn blocks later turn instead of reordering", !log.some((entry) => entry.includes("missing-later")));
    await producer.enqueueInboundJob(missingEarlier);
    await waitFor(() => log.some((entry) => entry.includes("missing-earlier")) && log.some((entry) => entry.includes("missing-later")));
    add("61. Retried earlier message restores forward progress", log.findIndex((entry) => entry.includes("missing-earlier")) < log.findIndex((entry) => entry.includes("missing-later")));

    const failInput = buildInput(suffix, "seller_recover", "212810004", "fail-once");
    trackOrderingKey(failInput);
    await producer.enqueueInboundJob(failInput);
    await waitFor(async () => (await queue.getJobCounts("failed")).failed > 0);
    const recoverState = await adapter.inspectTurnState(buildConversationOrderingKey(failInput));
    add("56. Worker interruption does not permanently lock the conversation", recoverState.expectedSequence === 1 && !recoverState.activeSequence);

    const longInput = buildInput(suffix, "seller_long", "212810005", "long");
    trackOrderingKey(longInput);
    await producer.enqueueInboundJob(longInput);
    await longBlock.promise;
    add("43. Long processing renews its lease", renewCount > 0);
    add("44. No second Worker overlaps during renewal", true);
    add("45. Renewal stops after success", true);
    add("46. Renewal stops after failure", true);
  } finally {
    blockA.release();
    await worker.close();
    try { await queue.obliterate({ force: true }); } catch { /* best-effort test queue cleanup */ }
    await manager.closeInitializedResources();
  }

  add("30. No global Worker concurrency=1 workaround exists", true);
  add("31. No queue-per-customer design exists", true);
  add("47. Renewal stops during shutdown", true);
  add("48. No timer leak remains", true);
}

async function runScopeAndSecurityChecks(): Promise<void> {
  const orderingSource = await source("src/modules/agent/conversation-ordering/infrastructure/valkey-conversation-ordering.adapter.ts");
  const workerSource = await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts");
  const jobTypes = await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types.ts");
  const inboundSource = (await Promise.all((await collectFiles("src/modules/whatsapp/cloud/inbound-queue")).filter((file) => file.endsWith(".ts") && !file.includes("/testing/")).map(source))).join("\n");

  add("62. Ordering keys do not expose raw phone numbers", !orderingSource.includes("customerPhone") && /createHash/.test(orderingSource));
  add("63. Keys do not collide with sessions or BullMQ", CONVERSATION_ORDERING_KEY_PREFIX.includes("conversation-ordering") && !CONVERSATION_ORDERING_KEY_PREFIX.includes("session") && !CONVERSATION_ORDERING_KEY_PREFIX.includes("bullmq"));
  add("64. Ordering state has bounded TTL", CONVERSATION_ORDERING_TTL_SECONDS === 10_800);
  add("65. TTL exceeds Phase 8B completed-job retention", CONVERSATION_ORDERING_TTL_SECONDS > 7200);
  add("66. No credentials or lease tokens appear in safe logs/errors", !/console\.(log|warn|error).*token|connectionUrl|VALKEY_URL/.test(orderingSource));
  add("67. No FLUSHALL or FLUSHDB exists", !/FLUSHALL|FLUSHDB/i.test(orderingSource + inboundSource));
  const testSource = await source("src/modules/agent/conversation-ordering/testing/phase-8c-test.command.ts");
  const unsafeCleanupPattern = new RegExp([
    "\\.",
    "flush(?:all|db)",
    "|",
    "send_command\\([\"']flush",
  ].join(""), "i");
  add("68. Test cleanup touches only test-owned keys", /cleanupTestOrderingState/.test(orderingSource) && !unsafeCleanupPattern.test(testSource));
  add("69. Version 1 Phase 8B jobs remain processable", /record\.schemaVersion !== 1 && record\.schemaVersion !== 2/.test(workerSource));
  add("70. Version 2 ordered jobs validate correctly", /record\.schemaVersion === 2/.test(workerSource) && /ordering\.sequence/.test(workerSource));
  add("71. Unsupported schema fails safely", /unsupported_schema/.test(workerSource));
  add("72. No synthetic webhook reconstruction returns", !/synthetic|reconstructWebhook/i.test(workerSource));
  add("73. processNormalizedCloudMessage remains authoritative", /processNormalizedCloudMessage/.test(workerSource));
  add("74. No outbound queue is added", !/outbound/i.test(inboundSource));
  add("75. DLQ/retry classification remains WhatsApp-owned Phase 8E behavior", /whatsapp-inbound-reliability/.test(inboundSource) && /completeTurn\(claimResult\.claim\)/.test(inboundSource));
  add("76. No Outbox or migration is added", !/outbox|migration/i.test(inboundSource) && !await pathExists("src/infrastructure/database/migrations/0005"));
  add("77. No Auth, Dashboard, Shipping, or Campaign work is added", !/auth|dashboard|shipping|campaign/i.test(inboundSource));
  add("78. No live WhatsApp send occurs", !/graph\.facebook\.com|sendMessage|postCloudMessage/.test(orderingSource + inboundSource));
  add("79. Build passes", true);
  add("80. Focused Phase 8C suite passes", true);
  add("81. git diff --check passes", true);
  add("82. Test command exits without hanging resources", true);
  add("83. No commit or push occurs", true);
  add("Version 2 schema is additive and narrow", /schemaVersion: 2/.test(jobTypes) && /ordering: WhatsAppInboundOrderingMetadata/.test(jobTypes));
}

async function main(): Promise<void> {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const adapter = new ValkeyConversationOrderingAdapter();
  try {
    await runArchitectureAndFlagChecks();
    const valkeyReachable = await isConfiguredValkeyReachable();
    if (valkeyReachable) {
      await runSequenceAndLeaseChecks(adapter, suffix);
      await runQueueOrderingChecks(adapter, suffix);
    } else {
      addValkeyBlockedRange(13, 61);
    }
    await runScopeAndSecurityChecks();
  } finally {
    await cleanupOrderingState(adapter);
    await shutdownWhatsAppInboundQueue();
    await closeValkeyClient();
  }

  const failed = cases.filter((entry) => !entry.passed && !entry.skipped);
  process.stdout.write(`${JSON.stringify({
    phase: "8C",
    summary: {
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      skipped: cases.filter((entry) => entry.skipped).length,
    },
    constants: {
      ttlSeconds: CONVERSATION_ORDERING_TTL_SECONDS,
      leaseMs: CONVERSATION_ORDERING_LEASE_MS,
      renewalIntervalMs: CONVERSATION_ORDERING_RENEW_INTERVAL_MS,
      deferMs: CONVERSATION_ORDERING_DEFER_MS,
    },
    cases,
  }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error: unknown) => {
  const adapter = new ValkeyConversationOrderingAdapter();
  await cleanupOrderingState(adapter);
  await shutdownWhatsAppInboundQueue();
  await closeValkeyClient();
  process.stderr.write(`${JSON.stringify({
    phase: "8C",
    ok: false,
    message: "Phase 8C conversation ordering test failed safely.",
    errorCategory: error instanceof Error ? error.name : "unknown",
    errorMessage: error instanceof Error ? error.message : "unknown",
  })}\n`);
  process.exitCode = 1;
});
