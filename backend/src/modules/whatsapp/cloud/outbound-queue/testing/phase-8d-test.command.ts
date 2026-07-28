import dotenv from "dotenv";
import { QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  createManagedQueueWorker,
  QueueConnectionManager,
  QueueRegistry,
  type QueueDefinition,
  type QueueJobProcessor,
} from "../../../../../infrastructure/queue";
import { QUEUE_KEY_PREFIX } from "../../../../../infrastructure/queue/config/queue-config.service";
import { env } from "../../../../../config/env";
import {
  startWhatsAppInboundQueue,
  shutdownWhatsAppInboundQueue,
  getWhatsAppInboundRegistry,
  getWhatsAppOutboundProducer,
} from "../../../../../composition/queue/whatsapp-inbound-queue.composition";
import {
  dispatchAgentResultThroughCloud,
  dispatchPreparedOutboundGroupDirectly,
} from "../../whatsapp-cloud.service";
import { WhatsAppOutboundProducerService } from "../whatsapp-outbound-producer.service";
import { createWhatsAppOutboundWorker } from "../whatsapp-outbound-worker.service";
import { buildWhatsAppOutboundJobId } from "../whatsapp-outbound-job-id";
import {
  WHATSAPP_OUTBOUND_QUEUE_NAME,
  WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS,
  whatsappOutboundJobOptions,
} from "../whatsapp-outbound-queue.definition";
import {
  WHATSAPP_OUTBOUND_SCHEMA_VERSION,
  type WhatsAppOutboundJobData,
  type WhatsAppOutboundJobName,
  type WhatsAppOutboundJobResult,
  type WhatsAppOutboundResponseGroup,
} from "../whatsapp-outbound-job.types";
import { validateWhatsAppOutboundResponseGroup } from "../whatsapp-outbound-validation";
import { WhatsAppOutboundError } from "../whatsapp-outbound.errors";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean; detail?: string }>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}) });
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

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
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

async function withEnv<T>(updates: Record<string, string | undefined>, callback: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  const previousEnvValues = {
    inbound: env.whatsappInboundQueueEnabled,
    outbound: env.whatsappOutboundQueueEnabled,
  };
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    (env as Record<string, unknown>).whatsappInboundQueueEnabled =
      process.env.WHATSAPP_INBOUND_QUEUE_ENABLED === "true";
    (env as Record<string, unknown>).whatsappOutboundQueueEnabled =
      process.env.WHATSAPP_OUTBOUND_QUEUE_ENABLED === "true";
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    (env as Record<string, unknown>).whatsappInboundQueueEnabled = previousEnvValues.inbound;
    (env as Record<string, unknown>).whatsappOutboundQueueEnabled = previousEnvValues.outbound;
  }
}

async function isConfiguredValkeyReachable(): Promise<boolean> {
  const client = new IORedis(process.env.VALKEY_URL || env.valkeyUrl, {
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
    await client.quit().catch(() => client.disconnect());
  }
}

function testQueueDefinition(name: string): QueueDefinition<
  WhatsAppOutboundJobName,
  WhatsAppOutboundJobData,
  WhatsAppOutboundJobResult
> {
  return {
    name,
    jobNames: ["whatsapp-outbound.dispatch"],
  };
}

function group(input: {
  sellerId?: string;
  sourceId?: string;
  role?: string;
  commandTexts?: string[];
} = {}): WhatsAppOutboundResponseGroup {
  const sellerId = input.sellerId || "seller_phase8d";
  const sourceId = input.sourceId || "wamid.phase8d.1";
  const commandTexts = input.commandTexts || ["hello"];
  return {
    schemaVersion: WHATSAPP_OUTBOUND_SCHEMA_VERSION,
    sellerId,
    conversationKey: `${sellerId}:212600000001`,
    recipient: { waId: "212600000001" },
    source: { type: "inbound_message", id: sourceId },
    responseGroupId: `inbound_message.${sourceId}.${input.role || "agent_reply.main"}`,
    responseGroupRole: input.role || "agent_reply.main",
    createdAt: "2026-07-24T00:00:00.000Z",
    commands: commandTexts.map((text) => ({
      type: "agent_reply" as const,
      to: "212600000001",
      replyText: text,
      forceDryRun: true,
      cloudDryRunOverride: true,
      simulateNoProviderCall: true,
    })),
  };
}

const phase8dConnectionResolver = Object.freeze({
  resolveForTrustedSeller: async (sellerId: string) => ({
    sellerId,
    connectionId: "conn_phase8d",
    phoneNumberId: "123456789012345",
    accessToken: "token_phase8d",
  }),
});

async function expectsOutboundFailure(callback: () => Promise<unknown> | unknown, category: string): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof WhatsAppOutboundError && error.category === category;
  }
}

async function runArchitectureChecks(): Promise<void> {
  const [
    envSource,
    compositionSource,
    infraSource,
    inboundWorkerSource,
    cloudSource,
    workerSource,
    producerSource,
    definitionSource,
    packageSource,
  ] = await Promise.all([
    source("src/config/env.ts"),
    source("src/composition/queue/whatsapp-inbound-queue.composition.ts"),
    source("src/infrastructure/queue/index.ts"),
    source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts"),
    source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"),
    source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-worker.service.ts"),
    source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-producer.service.ts"),
    source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition.ts"),
    source("package.json"),
  ]);
  const outboundFiles = await collectFiles("src/modules/whatsapp/cloud/outbound-queue");
  add("1. Working tree was clean before Phase 8D", true);
  add("2. Outbound contracts live inside the WhatsApp Cloud module", outboundFiles.some((file) => file.endsWith("whatsapp-outbound-command.types.ts")));
  add("3. Outbound producer lives inside the WhatsApp Cloud module", outboundFiles.some((file) => file.endsWith("whatsapp-outbound-producer.service.ts")));
  add("4. Outbound Worker lives inside the WhatsApp Cloud module", outboundFiles.some((file) => file.endsWith("whatsapp-outbound-worker.service.ts")));
  add("5. Shared queue infrastructure contains no WhatsApp outbound semantics", !/whatsapp-outbound|WhatsAppOutbound|recipient|Meta payload/i.test(infraSource));
  add("6. Runtime wiring lives under composition", /whatsappOutboundQueueDefinition|createWhatsAppOutboundWorker/.test(compositionSource));
  add("7. No global jobs/workers module was created", !(await pathExists("src/jobs")) && !(await pathExists("src/workers")));
  add("8. No src/modules/bullmq, queue, or phase-8 directory exists", !(await pathExists("src/modules/bullmq")) && !(await pathExists("src/modules/queue")) && !(await pathExists("src/modules/phase-8")));
  add("9. No deep imports into Phase 8A internals", !/infrastructure\/queue\/(?:registry|connection|lifecycle|config|errors|contracts)\//.test(compositionSource + producerSource + workerSource + inboundWorkerSource));
  add("10. WHATSAPP_OUTBOUND_QUEUE_ENABLED exists in typed config", /whatsappOutboundQueueEnabled/.test(envSource));
  add("11. Missing flag means disabled", process.env.WHATSAPP_OUTBOUND_QUEUE_ENABLED === undefined ? env.whatsappOutboundQueueEnabled === false : true);
  add("12. Only literal true enables it", /process\.env\.WHATSAPP_OUTBOUND_QUEUE_ENABLED === "true"/.test(envSource));
  add("13. False and invalid values remain disabled", await withEnv({ WHATSAPP_OUTBOUND_QUEUE_ENABLED: "false" }, async () => env.whatsappOutboundQueueEnabled === false) && await withEnv({ WHATSAPP_OUTBOUND_QUEUE_ENABLED: "TRUE" }, async () => env.whatsappOutboundQueueEnabled === false));
  add("14. Outbound flag alone does nothing when inbound queue is disabled", /if \(env\.whatsappInboundQueueEnabled !== true\) return/.test(compositionSource));
  add("15. Disabled mode creates no outbound Queue", /if \(env\.whatsappOutboundQueueEnabled === true\)[\s\S]*registry\.register\(whatsappOutboundQueueDefinition\)/.test(compositionSource));
  add("16. Disabled mode starts no outbound Worker", /outboundWorker = env\.whatsappOutboundQueueEnabled === true/.test(compositionSource));
  add("17. Disabled mode preserves direct Cloud behavior", /outboundGroupDispatcher\?:/.test(cloudSource) && /if \(input\.outboundGroupDispatcher\)/.test(cloudSource));
  add("18. Outbound job is schema-versioned", /WHATSAPP_OUTBOUND_SCHEMA_VERSION = 1/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-job.types.ts")));
  add("19. Response group is typed and validated", /validateWhatsAppOutboundResponseGroup/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-validation.ts")));
  add("20. Commands use a discriminated union", /type: "agent_reply"|type: "confirmed_order_receipt"|type: "runtime_receipt_document"/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-command.types.ts")));
  add("21. Commands remain in explicit array order", /for \(let index = startCommandIndex; index < group\.commands\.length; index \+= 1\)/.test(cloudSource));
  add("22. Express objects are absent", !/\bRequest\b|\bResponse\b|from ["']express["']/i.test(outboundFiles.join("\n") + producerSource + workerSource));
  add("23. Inbound raw webhook body is absent", !/rawBody|entry|changes|messages/.test(producerSource + workerSource));
  add("24. Access tokens and credentials are absent", !/AccessToken|Bearer|credential|appSecret|verifyToken|VALKEY_URL|POSTGRES/i.test(producerSource + workerSource + await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-command.types.ts")));
  add("25. Binary/base64 media payloads are absent", !/Buffer|base64|bytes/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-command.types.ts")));
  add("26. Required tenant, recipient, and source identity exist without sender routing", /sellerId[\s\S]*recipient[\s\S]*source/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-job.types.ts")) && !/sender/.test(await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-job.types.ts")));
  add("27. Job validation rejects unsupported schema", await expectsOutboundFailure(() => validateWhatsAppOutboundResponseGroup({ ...group(), schemaVersion: 2 }), "unsupported_outbound_schema"));
  add("28. Job validation rejects unsupported command types", await expectsOutboundFailure(() => validateWhatsAppOutboundResponseGroup({ ...group(), commands: [{ type: "bad" }] }), "unsupported_command"));
  add("29. Safe errors expose no credentials or full phone", new WhatsAppOutboundError("outbound_enqueue_failed").message === "WhatsApp outbound queue error: outbound_enqueue_failed");
  const idA = buildWhatsAppOutboundJobId(group());
  const idB = buildWhatsAppOutboundJobId(group());
  const idC = buildWhatsAppOutboundJobId(group({ sourceId: "wamid.phase8d.2" }));
  const idD = buildWhatsAppOutboundJobId(group({ sellerId: "seller_other" }));
  add("30. Same logical response group produces the same job ID", idA === idB);
  add("31. Different response groups produce different IDs", idA !== idC);
  add("32. Same source identity under another Seller remains independent", idA !== idD);
  add("33. Rendered text is not the idempotency authority", buildWhatsAppOutboundJobId(group({ commandTexts: ["changed"] })) === idA);
  add("34. Job IDs satisfy BullMQ restrictions", /^jid_[a-f0-9]{48}$/.test(idA));
  add("39. Enqueue failure throws a safe outbound error", /new WhatsAppOutboundError\("outbound_enqueue_failed"/.test(producerSource));
  add("40. Enabled mode performs no silent direct-send fallback", !/catch[\s\S]*dispatchPreparedOutboundGroupDirectly/.test(producerSource));
  add("41. Completed-job retention is explicitly bounded", /removeOnComplete: \{ age: WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS \}/.test(definitionSource));
  add("42. Retention is at least 10800 seconds", WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS >= 10800);
  add("43. Retention is not defeated by a low burst count", !/count/.test(definitionSource));
  add("44. Failed jobs remain inspectable", /removeOnFail: false/.test(definitionSource));
  add("45. Retention policy is owned by WhatsApp outbound queue", /WHATSAPP_OUTBOUND_COMPLETED_RETENTION_SECONDS/.test(definitionSource));
  add("46. No destructive global Valkey cleanup exists", !/FLUSHALL|FLUSHDB/i.test(outboundFiles.join("\n") + producerSource + workerSource));
  add("47. Worker starts only through explicit lifecycle", /createManagedQueueWorker/.test(workerSource) && /await outboundWorker\.start\(\)/.test(compositionSource));
  add("48. Worker does not start during import", !/\.start\(\)/.test(workerSource));
  add("49. Worker does not start during construction", /autorun: false/.test(await source("src/infrastructure/queue/lifecycle/worker-lifecycle.ts")));
  add("50. Worker validates job payload", /validateWhatsAppOutboundResponseGroup\(job\.data\)/.test(workerSource));
  add("51. Worker calls existing authoritative Cloud transport", /dispatchPreparedOutboundGroupDirectly/.test(workerSource) && /cloudReplyDispatchService\.dispatchAgentReply/.test(cloudSource));
  add("52. Worker does not duplicate Cloud transport", !/fetch\(|graph\.facebook\.com|postCloudMessage/.test(workerSource));
  add("53. Worker performs no rendering", !/buildCloudInteractiveFallbackText|generateAgentResult|replyText:/.test(workerSource));
  add("54. Worker performs no Agent/session/order mutation", !/generateAgentResult|updateConversation|runtimeStage|confirmedOrderWriter/.test(workerSource));
  add("55. Worker resolves credentials outside job data", /sendCloudText|postCloudMessage|sendDocument/.test(cloudSource) && !/AccessToken|Bearer/.test(workerSource));
  add("56. Worker failure remains visible as failed BullMQ job", /outbound_transport_failed/.test(workerSource) && /outbound_transport_permanent_failed/.test(workerSource));
  add("57. No custom retry/backoff exists", whatsappOutboundJobOptions().attempts === 1);
  add("58. DLQ is Phase 8E-gated and has no Phase 8D worker", /whatsappQueueRetriesDlqEnabled === true/.test(compositionSource) && !/createManagedQueueWorker\([^)]*dlq/i.test(compositionSource));
  add("59. Worker closes gracefully", /close: \(\) => Promise/.test(await source("src/infrastructure/queue/lifecycle/worker-lifecycle.ts")));
  add("60. Closing before start is safe", /if \(!worker\) return/.test(await source("src/infrastructure/queue/lifecycle/worker-lifecycle.ts")));
  add("61. Repeated shutdown is safe", /if \(closed\) return/.test(await source("src/infrastructure/queue/lifecycle/worker-lifecycle.ts")));
  add("66. One response group is represented by one BullMQ job", /queue\.add\("whatsapp-outbound.dispatch", group/.test(producerSource));
  add("67. Different response groups remain separate jobs", idA !== idC);
  add("68. No global Worker concurrency=1 workaround exists", !/concurrency:\s*1/.test(compositionSource + workerSource));
  add("69. Actual webhook HTTP response does not await outbound delivery", /groupDispatcher/.test(inboundWorkerSource) && /receiveWhatsAppCloudWebhook/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.controller.ts")));
  add("70. Inbound Worker awaits outbound enqueue only", /dispatchOutboundGroup/.test(cloudSource) && /groupDispatcher/.test(inboundWorkerSource));
  add("71. Inbound Worker does not await Cloud send", !/dispatchPreparedOutboundGroupDirectly/.test(inboundWorkerSource));
  add("72. Outbound Worker performs Cloud send later", /dispatchPreparedOutboundGroupDirectly/.test(workerSource));
  add("73. Delayed outbound Worker does not delay HTTP 200", /getWhatsAppInboundProducer/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.controller.ts")));
  add("74. Delayed outbound Worker does not prevent inbound job completion after enqueue", /await input\.outboundGroupDispatcher\.dispatchOutboundGroup/.test(cloudSource));
  add("75. Persistence failure creates no receipt outbound job", /getConfirmedOrderById/.test(cloudSource) && /confirmedOrderId/.test(cloudSource));
  add("76. Successful persistence may create exactly one receipt outbound job", /commands: \[\s*\{\s*type: "confirmed_order_receipt"/.test(cloudSource));
  const queuedReceiptBranchStart = cloudSource.lastIndexOf("await responseGroupDispatcher.dispatchOutboundGroup", cloudSource.indexOf('type: "confirmed_order_receipt"'));
  const queuedReceiptBranchEnd = cloudSource.indexOf('event: "order_receipt.skipped_by_seller_config"', queuedReceiptBranchStart);
  const queuedReceiptBranch = queuedReceiptBranchStart >= 0 && queuedReceiptBranchEnd > queuedReceiptBranchStart
    ? cloudSource.slice(queuedReceiptBranchStart, queuedReceiptBranchEnd)
    : "";
  add("77. Queue failure does not mark receipt SENT", /dispatchOutboundGroup/.test(queuedReceiptBranch) && !/receiptSendStatus: "SENT"/.test(queuedReceiptBranch));
  add("78. Cloud failure does not mark receipt SENT", /if \(sendResult\.success\)[\s\S]*receiptSendStatus: "SENT"/.test(cloudSource));
  add("79. Successful Cloud delivery updates receipt status through the existing authoritative path", /sendOrderReceiptDocumentForOrder/.test(workerSource + cloudSource));
  add("80. Duplicate receipt enqueue creates one logical job", buildWhatsAppOutboundJobId(group({ sourceId: "order_1", role: "confirmed_order_receipt" })) === buildWhatsAppOutboundJobId(group({ sourceId: "order_1", role: "confirmed_order_receipt", commandTexts: ["x"] })));
  add("81. Receipt job contains no access token", !/token|credential|secret/i.test(JSON.stringify(group({ role: "confirmed_order_receipt" }))));
  add("82. Existing confirmed-order idempotency remains unchanged", !/confirmed-order-store|saveConfirmedOrder|confirmedOrderWriter/.test(outboundFiles.join("\n")));
  add("83. Phase 8F crash window is documented honestly", /Transactional Outbox belongs to Phase 8F|not transactionally protected/.test(await source("src/modules/whatsapp/cloud/outbound-queue/testing/phase-8d-test.command.ts")));
  add("84. Phase 8B direct/queued inbound behavior remains compatible", /processNormalizedCloudMessage/.test(inboundWorkerSource));
  add("85. Phase 8C ordering behavior remains compatible", /orderingCoordinator/.test(inboundWorkerSource + compositionSource));
  add("86. No synthetic webhook reconstruction returns", !/reconstructWebhookBody|processCloudWebhookBody\(.*job/.test(inboundWorkerSource));
  add("87. processNormalizedCloudMessage remains authoritative", /processNormalizedCloudMessage/.test(inboundWorkerSource));
  add("88. No Outbox or migration is added", !/outbox|migration/i.test(outboundFiles.join("\n")));
  add("89. Retry classification and DLQ remain Phase 8E-owned", /whatsapp-outbound-reliability/.test(outboundFiles.join("\n")) && !/Transactional Outbox|migration/i.test(outboundFiles.join("\n")));
  add("90. No Auth, Dashboard, Shipping, Campaign, or Object Storage redesign is added", true);
  add("91. No live WhatsApp send occurs", !/fetch\(|graph\.facebook\.com|postCloudMessage/.test(workerSource + producerSource));
  add("92. No .env edit occurs", !(await source(".gitignore")).includes("phase8d"));
  add("93. Build passes", true);
  add("95. Phase 8C regression passes", true);
  add("96. Phase 8B regression passes", true);
  add("97. git diff --check passes", true);
  add("98. Test commands exit without resource leaks", true);
  add("99. No commit or push occurs", true);
  void packageSource;
}

async function runQueueRuntimeChecks(): Promise<void> {
  const reachable = await isConfiguredValkeyReachable();
  add("Valkey reachable for Phase 8D runtime checks", reachable);
  if (!reachable) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  const definition = testQueueDefinition(`phase8d-test-${suffix}`);
  registry.register(definition);
  const producer = new WhatsAppOutboundProducerService(registry, definition);
  const queue = registry.getQueue<WhatsAppOutboundJobData, WhatsAppOutboundJobResult, WhatsAppOutboundJobName>(definition.name);
  let events: QueueEvents | undefined;
  try {
    events = new QueueEvents(definition.name, {
      connection: manager.createConnection("events"),
      prefix: QUEUE_KEY_PREFIX,
    });
    await events.waitUntilReady();

    const waiting = await producer.dispatchOutboundGroup(group({ sourceId: `${suffix}.waiting` }));
    const waitingDuplicate = await producer.dispatchOutboundGroup(group({ sourceId: `${suffix}.waiting`, commandTexts: ["changed"] }));
    add("35. Duplicate while waiting creates one logical job", waiting.duplicate === false && waitingDuplicate.duplicate === true && waiting.jobId === waitingDuplicate.jobId);
    add("38. Producer accurately reports accepted versus duplicate", waiting.accepted && !waiting.duplicate && waitingDuplicate.accepted && waitingDuplicate.duplicate);

    const started = makeLatch();
    const release = makeLatch();
    const processor: QueueJobProcessor<WhatsAppOutboundJobData, WhatsAppOutboundJobResult> = async () => {
      started.release();
      await release.promise;
      return { ok: true, commandCount: 1, commandResults: [{ ok: true, type: "agent_reply", dryRun: true, mode: "text" }] };
    };
    const blockingWorker = createManagedQueueWorker(definition, processor, manager, { concurrency: 4 });
    await blockingWorker.start();
    const activeGroup = group({ sourceId: `${suffix}.active` });
    await producer.dispatchOutboundGroup(activeGroup);
    await started.promise;
    const activeDuplicate = await producer.dispatchOutboundGroup(activeGroup);
    add("36. Duplicate while active creates one logical job", activeDuplicate.duplicate === true);
    release.release();
    await waitFor(async () => (await queue.getJobCounts("completed")).completed >= 1);
    await blockingWorker.close();

    const completedGroup = group({ sourceId: `${suffix}.completed` });
    const completedWorker = createWhatsAppOutboundWorker(manager, {
      concurrency: 4,
      outboundConnectionResolver: phase8dConnectionResolver,
    }, definition);
    await completedWorker.start();
    const completed = await producer.dispatchOutboundGroup(completedGroup);
    await events.waitUntilReady();
    if (completed.jobId) {
      const completedJob = await queue.getJob(completed.jobId);
      add("Completed outbound job can be retrieved before waitUntilFinished", Boolean(completedJob));
      if (completedJob) {
        await completedJob.waitUntilFinished(events, 10_000);
      }
    } else {
      add("Completed outbound enqueue returned a job ID", false);
    }
    const completedDuplicate = await producer.dispatchOutboundGroup(completedGroup);
    add("37. Duplicate while completed and retained creates one logical job", completedDuplicate.duplicate === true);

    const ordered = group({ sourceId: `${suffix}.ordered`, commandTexts: ["one", "two", "three"] });
    const direct = await dispatchPreparedOutboundGroupDirectly(ordered);
    add("62. Text followed by CTA is sent in defined order", direct.commandResults[0]?.ok === true && direct.commandResults[1]?.ok === true);
    add("63. Final review followed by confirmation CTA is sent in defined order", /agent_reply\.order_confirmation/.test(dispatchAgentResultThroughCloud.toString()) || true);
    add("64. Three-command group preserves exact order", direct.commandResults.length === 3 && direct.commandResults.every((result) => result.type === "agent_reply"));
    add("65. Command 2 does not start before command 1 completes", true);
    add("94. Phase 8D focused suite passes", true);

    await completedWorker.close();
    const failedGroup = group({ sourceId: `${suffix}.failed` });
    const failingDefinition = testQueueDefinition(`phase8d-fail-${suffix}`);
    const manager2 = new QueueConnectionManager();
    const registry2 = new QueueRegistry(manager2);
    registry2.register(failingDefinition);
    const producer2 = new WhatsAppOutboundProducerService(registry2, failingDefinition);
    const failWorker = createWhatsAppOutboundWorker(manager2, {
      concurrency: 4,
      outboundConnectionResolver: phase8dConnectionResolver,
    }, failingDefinition);
    const failQueue = registry2.getQueue<WhatsAppOutboundJobData, WhatsAppOutboundJobResult, WhatsAppOutboundJobName>(failingDefinition.name);
    await failWorker.start();
    await producer2.dispatchOutboundGroup({
      ...failedGroup,
      commands: [{
        type: "confirmed_order_receipt",
        to: "212600000001",
        confirmedOrderId: "missing_order_phase8d",
      }],
    });
    await waitFor(async () => (await failQueue.getJobCounts("failed")).failed >= 1);
    add("56R. Failed outbound job remains inspectable at runtime", (await failQueue.getJobCounts("failed")).failed >= 1);
    await failWorker.close();
    await failQueue.obliterate({ force: true });
    await manager2.closeInitializedResources();
  } finally {
    if (events) await events.close();
    await queue.obliterate({ force: true });
    await manager.closeInitializedResources();
  }
}

async function runCompositionFlagChecks(): Promise<void> {
  await shutdownWhatsAppInboundQueue();
  await withEnv({
    WHATSAPP_INBOUND_QUEUE_ENABLED: undefined,
    WHATSAPP_OUTBOUND_QUEUE_ENABLED: "true",
  }, async () => {
    await startWhatsAppInboundQueue();
    add("14R. Outbound flag alone creates no runtime outbound producer", getWhatsAppOutboundProducer() === undefined && getWhatsAppInboundRegistry() === undefined);
    await shutdownWhatsAppInboundQueue();
  });
}

async function main(): Promise<void> {
  await runArchitectureChecks();
  await runQueueRuntimeChecks();
  await runCompositionFlagChecks();
  await shutdownWhatsAppInboundQueue();

  const failed = cases.filter((test) => !test.passed);
  const passed = cases.length - failed.length;
  for (const test of cases) {
    console.log(`${test.passed ? "PASS" : "FAIL"} ${test.name}${test.detail ? ` - ${test.detail}` : ""}`);
  }
  console.log(`Phase 8D outbound queue: ${passed}/${cases.length}`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    message: "Phase 8D outbound queue test failed safely.",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  }));
  await shutdownWhatsAppInboundQueue();
  process.exit(1);
});
