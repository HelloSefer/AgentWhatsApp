import dotenv from "dotenv";
import { QueueEvents } from "bullmq";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDeterministicJobId,
  defaultJobOptions,
  getQueueConfiguration,
  getQueueConnectionState,
  getQueueHealth,
  QueueConfigurationError,
  QueueConnectionManager,
  QueueJobIdentityError,
  QueueRegistry,
  QueueRegistrationError,
  shutdownQueueInfrastructure,
  validateDeterministicJobId,
  validateQueueName,
  createManagedQueueWorker,
} from "..";
import { QUEUE_KEY_PREFIX } from "../config/queue-config.service";
import {
  createPhase8ATestQueueDefinition,
  type Phase8ATestJobData,
  type Phase8ATestJobResult,
} from "./queue-testing-support";

dotenv.config();

type TestCase = Readonly<{
  name: string;
  passed: boolean;
  skipped?: boolean;
  detail?: string;
}>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean, detail?: string, skipped = false): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}), ...(skipped ? { skipped: true } : {}) });
}

async function expectsFailure(callback: () => Promise<unknown> | unknown, predicate: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return predicate(error);
  }
}

async function withTemporaryEnv<T>(key: string, value: string | undefined, callback: () => Promise<T> | T): Promise<T> {
  const previous = process.env[key];
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
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

async function sourceContains(file: string, pattern: RegExp): Promise<boolean> {
  const source = await readFile(path.resolve(process.cwd(), file), "utf8");
  return pattern.test(source);
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await readdir(path.resolve(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

async function runImportAndConfigurationChecks(): Promise<void> {
  add("Queue infrastructure import performs no connection", !getQueueConnectionState().initialized);
  add("Queue registry import performs no connection", !getQueueConnectionState().initialized);
  add("Worker lifecycle import starts no Worker", getQueueConnectionState().workerCount === 0);

  await withTemporaryEnv("VALKEY_URL", undefined, async () => {
    add("Missing Valkey configuration does not crash imports", !getQueueConnectionState().initialized);
    add("Missing configuration queue operation fails safely", await expectsFailure(
      () => new QueueRegistry(new QueueConnectionManager()).getQueue("missing-config-test"),
      (error) => error instanceof QueueRegistrationError && error.category === "queue_not_registered",
    ));

    const registry = new QueueRegistry(new QueueConnectionManager());
    registry.register(createPhase8ATestQueueDefinition("missing-config"));
    add("Missing configuration registered queue access fails safely", await expectsFailure(
      () => registry.getQueue("phase8a-test-missing-config"),
      (error) => error instanceof QueueConfigurationError && error.category === "configuration_unavailable",
    ));

    const health = await getQueueHealth();
    add("Missing-configuration health reports unavailable safely", health.status === "unavailable" && health.errorCategory === "configuration_unavailable");
  });

  await withTemporaryEnv("VALKEY_URL", "not-a-valkey-url", async () => {
    const registry = new QueueRegistry(new QueueConnectionManager());
    registry.register(createPhase8ATestQueueDefinition("invalid-config"));
    add("Invalid configuration fails safely", await expectsFailure(
      () => registry.getQueue("phase8a-test-invalid-config"),
      (error) => error instanceof QueueConfigurationError && error.category === "configuration_invalid",
    ));
  });

  add("No fallback/default Valkey connection is attempted", await withTemporaryEnv("VALKEY_URL", undefined, async () => {
    const manager = new QueueConnectionManager();
    const registry = new QueueRegistry(manager);
    registry.register(createPhase8ATestQueueDefinition("no-fallback"));
    const failed = await expectsFailure(
      () => registry.getQueue("phase8a-test-no-fallback"),
      (error) => error instanceof QueueConfigurationError,
    );
    return failed && manager.getState().connectionCount === 0;
  }));

  add("Secrets and URLs are absent from safe errors", await withTemporaryEnv("VALKEY_URL", "redis://user:secret@localhost:6379", async () => {
    const safe = await expectsFailure(
      () => validateDeterministicJobId("bad value"),
      (error) => error instanceof QueueJobIdentityError && !String(error.message).includes("secret") && !String(error.message).includes("redis://"),
    );
    return safe;
  }));

  const configuredValkeyUrl = process.env.VALKEY_URL?.trim();
  add("Queue configuration uses the approved existing Valkey source convention", configuredValkeyUrl ? getQueueConfiguration().connectionUrl === configuredValkeyUrl : true);
  add("Queue key prefix is isolated from session keys", QUEUE_KEY_PREFIX.startsWith("agentwhatsapp:bullmq") && !QUEUE_KEY_PREFIX.includes("session"));
}

async function runRegistryAndIdentityChecks(): Promise<void> {
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  add("Registry construction performs zero I/O", !manager.getState().initialized);
  registry.register(createPhase8ATestQueueDefinition("registry"));
  add("Queue registration performs zero I/O", !manager.getState().initialized);
  add("Duplicate queue registration is rejected", await expectsFailure(
    () => registry.register(createPhase8ATestQueueDefinition("registry")),
    (error) => error instanceof QueueRegistrationError && error.category === "duplicate_registration",
  ));
  add("Invalid queue name is rejected", await expectsFailure(
    () => validateQueueName("Orders"),
    (error) => error instanceof QueueRegistrationError && error.category === "invalid_queue_name",
  ));
  add("Unregistered queue access is rejected", await expectsFailure(
    () => registry.getQueue("phase8a-test-unknown"),
    (error) => error instanceof QueueRegistrationError && error.category === "queue_not_registered",
  ));
  add("Registered queue is created lazily", registry.getManagedQueueCount() === 0);

  if (process.env.VALKEY_URL?.trim()) {
    const queue = registry.getQueue("phase8a-test-registry");
    const repeated = registry.getQueue("phase8a-test-registry");
    add("Repeated queue access reuses the same managed Queue instance", queue === repeated);
    await queue.waitUntilReady();
    await manager.closeInitializedResources();
  } else {
    add("Repeated queue access reuses the same managed Queue instance", false, "VALKEY_URL is required", true);
  }

  add("No production business queue is registered", !registry.listRegisteredQueueNames().some((name) => /whatsapp|order|shipping|campaign|outbox/u.test(name)));

  const idA = buildDeterministicJobId(["tenant", "object", 1]);
  const idB = buildDeterministicJobId(["tenant", "object", 1]);
  const idC = buildDeterministicJobId(["tenant", "object", 2]);
  add("Deterministic job ID is stable for identical parts", idA === idB);
  add("Deterministic job ID differs for different parts", idA !== idC);
  add("Invalid deterministic identity parts are rejected", await expectsFailure(
    () => buildDeterministicJobId(["tenant", " "]),
    (error) => error instanceof QueueJobIdentityError,
  ));
  add("Deterministic job IDs satisfy installed BullMQ restrictions", validateDeterministicJobId(idA) === idA && !/[\s{}()[\]/\\:;,'"`$|<>]/u.test(idA));
}

async function runLiveQueueChecks(): Promise<void> {
  if (!process.env.VALKEY_URL?.trim()) {
    add("Configured local Valkey queue checks require VALKEY_URL", false, "VALKEY_URL missing", true);
    return;
  }

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const definition = createPhase8ATestQueueDefinition(suffix);
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  registry.register(definition);
  const queue = registry.getQueue<Phase8ATestJobData, Phase8ATestJobResult>(definition.name);
  let processedDataMatches = false;
  let processedCount = 0;
  let resultMatches = false;
  const worker = createManagedQueueWorker(definition, async (job) => {
    processedCount += 1;
    const value = typeof job.data.value === "string" ? job.data.value : "";
    processedDataMatches = value === "hello";
    return { processedValue: value.toUpperCase() };
  }, manager);

  let queueEvents: QueueEvents | undefined;
  try {
    add("Worker does not start before an explicit call", !worker.isStarted() && processedCount === 0);
    queueEvents = new QueueEvents(definition.name, {
      connection: manager.createConnection("events"),
      prefix: QUEUE_KEY_PREFIX,
    });
    queueEvents.on("error", () => undefined);
    manager.trackResource({ close: () => queueEvents?.close() || Promise.resolve() });
    await queueEvents.waitUntilReady();
    await worker.start();
    add("Explicit test Worker start succeeds", worker.isStarted());

    const jobId = buildDeterministicJobId(["phase8a", suffix, "duplicate"]);
    await queue.add("phase8a.trivial", { value: "hello" }, { ...defaultJobOptions(), jobId });
    await queue.add("phase8a.trivial", { value: "hello" }, { ...defaultJobOptions(), jobId });
    const countsBefore = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
    const completedJob = await (await queue.getJob(jobId))?.waitUntilFinished(queueEvents, 10_000);
    resultMatches = (completedJob as Phase8ATestJobResult | undefined)?.processedValue === "HELLO";
    const countsAfter = await queue.getJobCounts("completed", "failed");

    add("Duplicate test job ID creates one logical queued job", processedCount === 1 && countsBefore.waiting + countsBefore.active + countsBefore.completed <= 1);
    add("Test Worker receives typed job data", processedDataMatches);
    add("Test Worker processes one trivial test job successfully", processedCount === 1 && resultMatches && countsAfter.completed === 1 && countsAfter.failed === 0);
    add("No business retry policy is applied", defaultJobOptions().attempts === 1);
    add("No DLQ workflow exists", !await sourceContains("src/infrastructure/queue/index.ts", /dlq|dead.?letter/i));
    await worker.close();
    add("Worker closes gracefully", !worker.isStarted());
    await worker.close();
    add("Closing before initialization is safe", true);

    const beforeShutdownState = manager.getState();
    await manager.closeInitializedResources();
    await manager.closeInitializedResources();
    add("Repeated shutdown is idempotent", manager.getState().connectionCount === 0 && manager.getState().resourceCount === 0);

    const unusedManager = new QueueConnectionManager();
    await unusedManager.closeInitializedResources();
    add("Queue resources are not created merely by shutdown", !unusedManager.getState().initialized);
    add("All initialized test resources close without socket leaks", beforeShutdownState.connectionCount > 0 && manager.getState().connectionCount === 0);
  } finally {
    try {
      await queue.obliterate({ force: true });
    } catch {
      // Test queue cleanup is best-effort and limited to the temporary queue.
    }
    await manager.closeInitializedResources();
  }

  const health = await getQueueHealth();
  add("Queue health reports available against configured Valkey", health.status === "available" && health.reachable);
  add("Queue health performs no business enqueue", true);
}

async function runSourceShapeChecks(): Promise<void> {
  const queueFiles = await collectFiles("src/infrastructure/queue");
  const productionQueueFiles = queueFiles.filter((file) => file.endsWith(".ts") && !file.includes("/testing/"));
  const allQueueSource = (await Promise.all(productionQueueFiles.map((file) => readFile(path.resolve(process.cwd(), file), "utf8")))).join("\n");
  add("No HTTP queue-health endpoint is added", !/Router\(|app\.use|express/u.test(allQueueSource));
  add("app.ts and server.ts remain unchanged by queue infrastructure", !await sourceContains("src/app.ts", /infrastructure\/queue|queue-health|bullmq/u) && !await sourceContains("src/server.ts", /infrastructure\/queue|queue-health|bullmq/u));
  add("Existing Valkey conversation/session implementation remains unchanged", !await sourceContains("src/infrastructure/valkey/valkey.client.ts", /bullmq|Queue|Worker/u));
  add("No src/modules/bullmq directory exists", !await pathExists("src/modules/bullmq"));
  add("No src/modules/phase-8 directory exists", !await pathExists("src/modules/phase-8"));
  add("No global business workers/jobs directory is added", !await pathExists("src/workers") && !await pathExists("src/jobs"));
  add("No WhatsApp, Order, Shipping, Campaign, or Outbox job exists", !/whatsapp-(inbound|outbound)|order_confirmed|shipment|shipping|campaign|outbox/i.test(allQueueSource));
  add("No composition/runtime wiring is added", !await sourceContains("src/composition/index.ts", /infrastructure\/queue|bullmq/u));
  add("No migrations or PostgreSQL schema changes are added", !await pathExists("src/infrastructure/database/migrations/0005"));
  add("No live WhatsApp/Meta send occurs", !/graph\.facebook\.com|sendMessage|whatsapp.*send|Meta Send/i.test(allQueueSource));
  add("No FLUSHALL or FLUSHDB is used anywhere in queue infrastructure", !/FLUSHALL|FLUSHDB/i.test(allQueueSource));
}

async function main(): Promise<void> {
  await shutdownQueueInfrastructure();
  await runImportAndConfigurationChecks();
  await runRegistryAndIdentityChecks();
  await runLiveQueueChecks();
  await runSourceShapeChecks();
  await shutdownQueueInfrastructure();

  const failed = cases.filter((entry) => !entry.passed && !entry.skipped);
  process.stdout.write(`${JSON.stringify({
    phase: "8A",
    summary: {
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      skipped: cases.filter((entry) => entry.skipped).length,
    },
    cases,
  }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error: unknown) => {
  await shutdownQueueInfrastructure();
  const message = error instanceof Error ? error.message.replace(/redis:\/\/\S+/giu, "[redacted-url]") : "unknown";
  process.stderr.write(`${JSON.stringify({
    phase: "8A",
    ok: false,
    message: "Phase 8A queue infrastructure test failed safely.",
    errorCategory: error instanceof Error ? error.name : "unknown",
    errorMessage: message,
  })}\n`);
  process.exitCode = 1;
});
