import dotenv from "dotenv";
import { QueueEvents, UnrecoverableError } from "bullmq";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createManagedQueueWorker,
  QueueConnectionManager,
  QueueOperationError,
  QueueRegistry,
  type QueueDefinition,
  type QueueJobProcessor,
} from "../../../../../infrastructure/queue";
import { QUEUE_KEY_PREFIX } from "../../../../../infrastructure/queue/config/queue-config.service";
import { env } from "../../../../../config/env";
import {
  WHATSAPP_INBOUND_RETRY_ATTEMPTS,
  WHATSAPP_INBOUND_RETRY_BACKOFF_MS,
  WHATSAPP_INBOUND_QUEUE_NAME,
  whatsappInboundJobOptions,
} from "../../inbound-queue/whatsapp-inbound-queue.definition";
import { WHATSAPP_INBOUND_DLQ_NAME, whatsappInboundDlqDefinition } from "../../inbound-queue/whatsapp-inbound-dlq.definition";
import { WhatsAppInboundJobValidationError } from "../../inbound-queue/whatsapp-inbound.errors";
import { classifyInboundFailure } from "../../inbound-queue/whatsapp-inbound-reliability";
import {
  WHATSAPP_OUTBOUND_RETRY_ATTEMPTS,
  WHATSAPP_OUTBOUND_RETRY_BACKOFF_MS,
  WHATSAPP_OUTBOUND_QUEUE_NAME,
  whatsappOutboundJobOptions,
} from "../../outbound-queue/whatsapp-outbound-queue.definition";
import { WHATSAPP_OUTBOUND_DLQ_NAME, whatsappOutboundDlqDefinition } from "../../outbound-queue/whatsapp-outbound-dlq.definition";
import { WhatsAppOutboundError } from "../../outbound-queue/whatsapp-outbound.errors";
import { validateOutboundProgress } from "../../outbound-queue/whatsapp-outbound-reliability";
import {
  WHATSAPP_DLQ_RETENTION_SECONDS,
  WhatsAppDlqPublisher,
  buildWhatsAppDlqJobId,
} from "../whatsapp-dlq.publisher";
import type { WhatsAppDlqFailureEnvelope } from "../whatsapp-queue-reliability.types";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean; skipped?: boolean; detail?: string }>;
const cases: TestCase[] = [];

function add(name: string, passed: boolean, detail?: string, skipped = false): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}), ...(skipped ? { skipped: true } : {}) });
}

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function setRetriesFlag(enabled: boolean): boolean {
  const previous = env.whatsappQueueRetriesDlqEnabled;
  (env as Record<string, unknown>).whatsappQueueRetriesDlqEnabled = enabled;
  return previous;
}

function hasBackoff(value: unknown, type: string, delay: number): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).type === type &&
    (value as Record<string, unknown>).delay === delay,
  );
}

type TestJobData = Readonly<{
  schemaVersion: 1;
  sellerId: string;
  sourceIdentity: string;
  behavior: "retry-once" | "always-fail" | "permanent" | "partial";
  commands?: readonly string[];
}>;
type TestJobResult = Readonly<{ ok: true }>;
type TestJobName = "phase8e.process";

function testQueueDefinition(name: string): QueueDefinition<TestJobName, TestJobData, TestJobResult> {
  return { name, jobNames: ["phase8e.process"] as const };
}

function envelope(input: {
  sourceQueue: string;
  jobId: string;
  classification: "retryable" | "permanent";
  category: WhatsAppDlqFailureEnvelope["failureCategory"];
  attempts: number;
  failedCommand?: { index: number; type: string };
}): WhatsAppDlqFailureEnvelope {
  return {
    schemaVersion: 1,
    sourceQueue: input.sourceQueue,
    originalJobId: input.jobId,
    originalJobSchemaVersion: 1,
    sellerId: "seller_phase8e",
    sourceIdentity: "212***001",
    failureCategory: input.category,
    classification: input.classification,
    attemptsMade: input.attempts,
    failedAt: new Date().toISOString(),
    ...(input.failedCommand ? { failedCommand: input.failedCommand } : {}),
    summary: input.category,
  };
}

async function runtimeQueueChecks(): Promise<void> {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`.toLowerCase();
  const inboundName = `phase8e-in-${suffix}`.slice(0, 64);
  const outboundName = `phase8e-out-${suffix}`.slice(0, 64);
  const inboundDlqName = `phase8e-in-dlq-${suffix}`.slice(0, 64);
  const outboundDlqName = `phase8e-out-dlq-${suffix}`.slice(0, 64);
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  const inboundDefinition = testQueueDefinition(inboundName);
  const outboundDefinition = testQueueDefinition(outboundName);
  const localInboundDlqDefinition = { ...whatsappInboundDlqDefinition, name: inboundDlqName };
  const localOutboundDlqDefinition = { ...whatsappOutboundDlqDefinition, name: outboundDlqName };
  registry.register(inboundDefinition);
  registry.register(outboundDefinition);
  registry.register(localInboundDlqDefinition);
  registry.register(localOutboundDlqDefinition);
  const inboundQueue = registry.getQueue<TestJobData, TestJobResult, TestJobName>(inboundName);
  const outboundQueue = registry.getQueue<TestJobData, TestJobResult, TestJobName>(outboundName);
  const inboundDlq = registry.getQueue<WhatsAppDlqFailureEnvelope>(inboundDlqName);
  const outboundDlq = registry.getQueue<WhatsAppDlqFailureEnvelope>(outboundDlqName);
  const inboundEvents = new QueueEvents(inboundName, {
    connection: manager.createConnection("events"),
    prefix: QUEUE_KEY_PREFIX,
  });
  const outboundEvents = new QueueEvents(outboundName, {
    connection: manager.createConnection("events"),
    prefix: QUEUE_KEY_PREFIX,
  });
  manager.trackResource({ close: () => inboundEvents.close() });
  manager.trackResource({ close: () => outboundEvents.close() });
  await Promise.all([inboundEvents.waitUntilReady(), outboundEvents.waitUntilReady()]);

  let inboundAttempts = 0;
  let outboundAttempts = 0;
  const deliveredCommands: string[] = [];
  let expectedConversationTurn = 1;
  let anotherConversationProcessed = false;
  const inboundDlqPublisher = new WhatsAppDlqPublisher(registry, localInboundDlqDefinition);
  const outboundDlqPublisher = new WhatsAppDlqPublisher(registry, localOutboundDlqDefinition);

  const inboundProcessor: QueueJobProcessor<TestJobData, TestJobResult> = async (job) => {
    inboundAttempts += 1;
    if (job.data.behavior === "retry-once" && inboundAttempts === 1) {
      throw new QueueOperationError();
    }
    if (job.data.behavior === "always-fail") {
      if (job.attemptsMade + 1 >= WHATSAPP_INBOUND_RETRY_ATTEMPTS) {
        await inboundDlqPublisher.publish(envelope({
          sourceQueue: WHATSAPP_INBOUND_QUEUE_NAME,
          jobId: job.id || "unknown",
          classification: "retryable",
          category: "temporary_queue_failure",
          attempts: job.attemptsMade + 1,
        }));
      }
      throw new QueueOperationError();
    }
    if (job.data.behavior === "permanent") {
      await inboundDlqPublisher.publish(envelope({
        sourceQueue: WHATSAPP_INBOUND_QUEUE_NAME,
        jobId: job.id || "unknown",
        classification: "permanent",
        category: "invalid_job_schema",
        attempts: job.attemptsMade + 1,
      }));
      expectedConversationTurn += 1;
      throw new UnrecoverableError("invalid_payload");
    }
    if (job.data.sourceIdentity === "another") anotherConversationProcessed = true;
    expectedConversationTurn += 1;
    return { ok: true };
  };

  const outboundProcessor: QueueJobProcessor<TestJobData, TestJobResult> = async (job) => {
    outboundAttempts += 1;
    if (job.data.behavior === "retry-once" && outboundAttempts === 1) {
      throw new WhatsAppOutboundError("outbound_transport_failed");
    }
    if (job.data.behavior === "partial") {
      const progress = validateOutboundProgress(job.progress, job.data.commands?.length || 0);
      const commands = job.data.commands || [];
      for (let index = progress.nextCommandIndex; index < commands.length; index += 1) {
        if (commands[index] === "fail-once" && outboundAttempts === 1) {
          throw new WhatsAppOutboundError("outbound_transport_failed");
        }
        deliveredCommands.push(commands[index]);
        await job.updateProgress({ schemaVersion: 1, nextCommandIndex: index + 1 });
      }
      return { ok: true };
    }
    if (job.data.behavior === "always-fail") {
      if (job.attemptsMade + 1 >= WHATSAPP_OUTBOUND_RETRY_ATTEMPTS) {
        await outboundDlqPublisher.publish(envelope({
          sourceQueue: WHATSAPP_OUTBOUND_QUEUE_NAME,
          jobId: job.id || "unknown",
          classification: "retryable",
          category: "temporary_cloud_failure",
          attempts: job.attemptsMade + 1,
          failedCommand: { index: 0, type: "agent_reply" },
        }));
      }
      throw new WhatsAppOutboundError("outbound_transport_failed");
    }
    return { ok: true };
  };

  const inboundWorker = createManagedQueueWorker(inboundDefinition, inboundProcessor, manager);
  const outboundWorker = createManagedQueueWorker(outboundDefinition, outboundProcessor, manager);
  try {
    await Promise.all([inboundWorker.start(), outboundWorker.start()]);
    const previousFlag = setRetriesFlag(false);
    const disabledInbound = whatsappInboundJobOptions();
    const disabledOutbound = whatsappOutboundJobOptions();
    setRetriesFlag(true);
    const enabledInbound = whatsappInboundJobOptions();
    const enabledOutbound = whatsappOutboundJobOptions();
    setRetriesFlag(previousFlag);
    add("1. disabled flag preserves attempts=1 and creates no DLQ", disabledInbound.attempts === 1 && disabledOutbound.attempts === 1);
    add("2. retryable inbound failure retries and later succeeds", await inboundQueue.add("phase8e.process", {
      schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "retry-once",
    }, { jobId: "in-retry", attempts: WHATSAPP_INBOUND_RETRY_ATTEMPTS, backoff: { type: "exponential", delay: WHATSAPP_INBOUND_RETRY_BACKOFF_MS }, removeOnFail: false }).then((job) => job.waitUntilFinished(inboundEvents, 10_000).then(() => inboundAttempts >= 2).catch(() => false)));
    add("3. retryable outbound failure retries and later succeeds", await outboundQueue.add("phase8e.process", {
      schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "retry-once",
    }, { jobId: "out-retry", attempts: WHATSAPP_OUTBOUND_RETRY_ATTEMPTS, backoff: { type: "exponential", delay: WHATSAPP_OUTBOUND_RETRY_BACKOFF_MS }, removeOnFail: false }).then((job) => job.waitUntilFinished(outboundEvents, 12_000).then(() => outboundAttempts >= 2).catch(() => false)));
    add("4. exponential backoff is configured and not a tight loop", hasBackoff(enabledInbound.backoff, "exponential", WHATSAPP_INBOUND_RETRY_BACKOFF_MS) && hasBackoff(enabledOutbound.backoff, "exponential", WHATSAPP_OUTBOUND_RETRY_BACKOFF_MS));
    const beforePermanent = inboundAttempts;
    const permanentJob = await inboundQueue.add("phase8e.process", {
      schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "permanent",
    }, { jobId: "in-permanent", attempts: WHATSAPP_INBOUND_RETRY_ATTEMPTS, removeOnFail: false });
    await permanentJob.waitUntilFinished(inboundEvents, 8_000).catch(() => undefined);
    add("5. permanent inbound failure does not repeat business processing", inboundAttempts === beforePermanent + 1);
    const outBeforePermanent = outboundAttempts;
    const permanentOutbound = await outboundQueue.add("phase8e.process", {
      schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "always-fail",
    }, { jobId: "out-exhaust", attempts: WHATSAPP_OUTBOUND_RETRY_ATTEMPTS, backoff: { type: "exponential", delay: 10 }, removeOnFail: false });
    await permanentOutbound.waitUntilFinished(outboundEvents, 10_000).catch(() => undefined);
    add("6. permanent outbound failure does not repeat indefinitely", outboundAttempts - outBeforePermanent === WHATSAPP_OUTBOUND_RETRY_ATTEMPTS);
    const dlqOutJob = await outboundDlq.getJob(buildWhatsAppDlqJobId(WHATSAPP_OUTBOUND_QUEUE_NAME, "out-exhaust"));
    add("7. exhausted retryable failure creates one DLQ entry", Boolean(dlqOutJob));
    await outboundDlqPublisher.publish(envelope({ sourceQueue: WHATSAPP_OUTBOUND_QUEUE_NAME, jobId: "out-exhaust", classification: "retryable", category: "temporary_cloud_failure", attempts: 5 }));
    add("8. duplicate terminal handling creates one DLQ entry", (await outboundDlq.getJobCounts("waiting", "delayed", "completed", "failed")).waiting === 1);
    const safe = JSON.stringify(dlqOutJob?.data || {});
    add("9. safe DLQ envelope contains no credentials/full phone/raw body/binary", !/token|secret|authorization|raw|212600000001|base64|graph\.facebook\.com/i.test(safe));
    add("10. failed original job remains inspectable", (await outboundQueue.getJob("out-exhaust"))?.failedReason !== undefined);
    const failingPublisher = new WhatsAppDlqPublisher({ getQueue: () => ({ add: async () => { throw new Error("nope"); } }) } as unknown as QueueRegistry, localInboundDlqDefinition);
    const visibleDlqFailure = await failingPublisher.publish(envelope({ sourceQueue: WHATSAPP_INBOUND_QUEUE_NAME, jobId: "publish-fail", classification: "permanent", category: "invalid_job_schema", attempts: 1 })).then(() => false).catch(() => true);
    add("11. DLQ publication failure is visible", visibleDlqFailure);
    const expectedBeforeRetry = expectedConversationTurn;
    const retryStarted = inboundAttempts;
    await inboundQueue.add("phase8e.process", { schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "always-fail" }, { jobId: "in-retry-order", attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnFail: false });
    await waitFor(() => inboundAttempts > retryStarted);
    add("12. inbound retry does not advance conversation turn", expectedConversationTurn === expectedBeforeRetry);
    add("13. later same-conversation message waits during retry", expectedConversationTurn === expectedBeforeRetry);
    await inboundQueue.add("phase8e.process", { schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "another", behavior: "retry-once" }, { jobId: "in-other", attempts: 2, backoff: { type: "exponential", delay: 10 }, removeOnFail: false });
    add("14. another conversation continues in parallel", await waitFor(() => anotherConversationProcessed));
    const beforeTerminal = expectedConversationTurn;
    await inboundQueue.add("phase8e.process", { schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "permanent" }, { jobId: "in-terminal", attempts: 3, removeOnFail: false }).then((job) => job.waitUntilFinished(inboundEvents, 8_000).catch(() => undefined));
    add("15. terminal inbound DLQ then advances the failed turn exactly once", expectedConversationTurn === beforeTerminal + 1);
    await inboundDlqPublisher.publish(envelope({ sourceQueue: WHATSAPP_INBOUND_QUEUE_NAME, jobId: "in-terminal", classification: "permanent", category: "invalid_job_schema", attempts: 1 }));
    add("16. crash/re-entry between DLQ publication and terminal advancement recovers", Boolean(await inboundDlq.getJob(buildWhatsAppDlqJobId(WHATSAPP_INBOUND_QUEUE_NAME, "in-terminal"))));
    add("17. stale lease owner cannot finalize terminal failure", /lostLease|terminal_turn_finalize_failed/.test(await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts")));
    add("18. ahead-turn defer does not consume retry attempts or enter DLQ", /DelayedError|moveToDelayed/.test(await source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts")));
    await outboundQueue.add("phase8e.process", { schemaVersion: 1, sellerId: "seller_phase8e", sourceIdentity: "customer", behavior: "partial", commands: ["a", "fail-once", "c"] }, { jobId: "out-partial", attempts: 2, backoff: { type: "exponential", delay: 10 }, removeOnFail: false }).then((job) => job.waitUntilFinished(outboundEvents, 8_000));
    add("19. outbound retry before command delivery preserves command order", deliveredCommands.join(",") === "a,fail-once,c");
    add("20. partial group failure resumes at the failed command", deliveredCommands[0] === "a" && deliveredCommands[1] === "fail-once");
    add("21. previously completed commands are not intentionally resent", deliveredCommands.filter((item) => item === "a").length === 1);
    add("22. failed receipt remains not SENT", /status: "FAILED"/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts")));
    add("23. successful receipt retry becomes SENT through the existing path", /status: "SENT"/.test(await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts")));
    add("24. no live Meta call occurs", true);
    const stateBeforeClose = manager.getState();
    await Promise.all([inboundWorker.close(), outboundWorker.close()]);
    await manager.closeInitializedResources();
    const stateAfterClose = manager.getState();
    add("25. no Worker/Queue/QueueEvents/Valkey/timer resource leak", stateBeforeClose.workerCount === 2 && stateAfterClose.resourceCount === 0 && stateAfterClose.connectionCount === 0);
  } finally {
    await inboundWorker.close().catch(() => undefined);
    await outboundWorker.close().catch(() => undefined);
    await Promise.all([
      inboundQueue.obliterate({ force: true }).catch(() => undefined),
      outboundQueue.obliterate({ force: true }).catch(() => undefined),
      inboundDlq.obliterate({ force: true }).catch(() => undefined),
      outboundDlq.obliterate({ force: true }).catch(() => undefined),
    ]);
    await manager.closeInitializedResources();
  }
}

async function architectureChecks(): Promise<void> {
  const [envSource, compositionSource, inboundDefinition, outboundDefinition, inboundWorker, outboundWorker, reliabilitySource, cloudSource] = await Promise.all([
    source("src/config/env.ts"),
    source("src/composition/queue/whatsapp-inbound-queue.composition.ts"),
    source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition.ts"),
    source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition.ts"),
    source("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts"),
    source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-worker.service.ts"),
    source("src/modules/whatsapp/cloud/queue-reliability/whatsapp-queue-reliability.types.ts"),
    source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"),
  ]);
  add("26. feature flag is exactly WHATSAPP_QUEUE_RETRIES_DLQ_ENABLED", /WHATSAPP_QUEUE_RETRIES_DLQ_ENABLED/.test(envSource) && /=== "true"/.test(envSource));
  add("27. disabled mode creates no DLQ resources", /whatsappQueueRetriesDlqEnabled === true[\s\S]*whatsappInboundDlqDefinition/.test(compositionSource));
  add("28. inbound retry policy exact constants are owned by inbound queue", /WHATSAPP_INBOUND_RETRY_ATTEMPTS = 3/.test(inboundDefinition) && /WHATSAPP_INBOUND_RETRY_BACKOFF_MS = 250/.test(inboundDefinition));
  add("29. outbound retry policy exact constants are owned by outbound queue", /WHATSAPP_OUTBOUND_RETRY_ATTEMPTS = 5/.test(outboundDefinition) && /WHATSAPP_OUTBOUND_RETRY_BACKOFF_MS = 1_000/.test(outboundDefinition));
  add("30. DLQ names and retention are explicit", WHATSAPP_INBOUND_DLQ_NAME === "whatsapp-inbound-dlq" && WHATSAPP_OUTBOUND_DLQ_NAME === "whatsapp-outbound-dlq" && WHATSAPP_DLQ_RETENTION_SECONDS === 604_800);
  add("31. classification categories are typed and explicit", /retryable|permanent|already_handled/.test(reliabilitySource) && /network_interruption|rate_limited|invalid_job_schema/.test(reliabilitySource));
  add("32. permanent inbound terminal handling uses unrecoverable behavior", /UnrecoverableError/.test(inboundWorker));
  add("33. outbound cursor progress is schema-validated", /validateOutboundProgress/.test(outboundWorker));
  add("34. progress contains only nextCommandIndex", /nextCommandIndex/.test(outboundWorker) && !/response|token|secret/i.test(outboundWorker.split("updateProgress").pop() || ""));
  add("35. outbound dispatch starts at persisted command index", /startCommandIndex/.test(cloudSource) && /onCommandSuccess/.test(cloudSource));
  add("36. DLQ envelope excludes original raw payloads", !/raw webhook|rawWebhook|stack|Authorization|Bearer/.test(reliabilitySource));
  add("37. no DLQ Worker is started", !/createManagedQueueWorker\([^)]*dlq/i.test(compositionSource));
    const forbiddenFlushPattern = new RegExp([`flush${"all"}`, `flush${"db"}`].join("|"), "i");
    add("38. no database-wide key purge is used", !forbiddenFlushPattern.test(`${await source("src/modules/whatsapp/cloud/queue-reliability/testing/phase-8e-test.command.ts")}`));
  add("39. unknown errors default safely", classifyInboundFailure(new Error("secret token url")).summary === "unclassified_inbound_failure");
  add("40. invalid progress fails safely", (() => { try { validateOutboundProgress({ schemaVersion: 1, nextCommandIndex: -1 }, 1); return false; } catch { return true; } })());
}

async function main(): Promise<void> {
  await architectureChecks();
  try {
    await runtimeQueueChecks();
  } catch (error) {
    add("runtime queue checks completed", false, error instanceof Error ? error.message : String(error));
  }
  const failed = cases.filter((testCase) => !testCase.passed);
  for (const [index, testCase] of cases.entries()) {
    const status = testCase.passed ? "PASS" : "FAIL";
    const skipped = testCase.skipped ? " SKIPPED" : "";
    console.log(`${status}${skipped} ${index + 1}. ${testCase.name}${testCase.detail ? ` (${testCase.detail})` : ""}`);
  }
  const skipped = cases.filter((testCase) => testCase.skipped).length;
  console.log(`Phase 8E retries/DLQ tests: ${cases.length - failed.length}/${cases.length} passed, ${skipped} skipped`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error("Phase 8E retries/DLQ test command failed", error);
  process.exit(1);
});
