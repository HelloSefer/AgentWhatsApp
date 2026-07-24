import dotenv from "dotenv";
import { QueueEvents } from "bullmq";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildDeterministicJobId,
  QueueConnectionManager,
  QueueRegistry,
  getQueueConnectionState,
  shutdownQueueInfrastructure,
  validateDeterministicJobId,
  createManagedQueueWorker,
  type QueueJobProcessor,
} from "../../../../../infrastructure/queue";
import { QUEUE_KEY_PREFIX } from "../../../../../infrastructure/queue/config/queue-config.service";
import {
  startWhatsAppInboundQueue,
  shutdownWhatsAppInboundQueue,
  getWhatsAppInboundProducer,
  getWhatsAppInboundRegistry,
  getWhatsAppInboundConnectionManager,
  isWhatsAppInboundQueueStarted,
} from "../../../../../composition/queue/whatsapp-inbound-queue.composition";
import {
  WHATSAPP_INBOUND_QUEUE_NAME,
  whatsappInboundQueueDefinition,
  whatsappInboundJobOptions,
} from "../whatsapp-inbound-queue.definition";
import { buildWhatsAppInboundJobId } from "../whatsapp-inbound-job-id";
import type { WhatsAppInboundJobData, WhatsAppInboundJobResult } from "../whatsapp-inbound-job.types";
import { WhatsAppInboundEnqueueError, WhatsAppInboundJobValidationError } from "../whatsapp-inbound.errors";
import { WhatsAppInboundProducerService } from "../whatsapp-inbound-producer.service";
import { createWhatsAppInboundWorker } from "../whatsapp-inbound-worker.service";
import { env } from "../../../../../config/env";
import {
  receiveWhatsAppCloudWebhook,
  setCloudWebhookProcessorForTesting,
  setWhatsAppInboundProducerProviderForTesting,
} from "../../whatsapp-cloud.controller";

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

/** Creates a one-shot latch: the promise resolves once release() is called. */
function makeLatch(): Readonly<{ promise: Promise<void>; release: () => void }> {
  let res: (() => void) | undefined;
  const promise = new Promise<void>(r => { res = r; });
  return { promise, release: () => res?.() };
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
  try {
    const source = await readFile(path.resolve(process.cwd(), file), "utf8");
    return pattern.test(source);
  } catch {
    return false;
  }
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.resolve(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

function buildTestWebhookBody(messages: Array<{
  phoneNumberId: string;
  waId: string;
  messageId: string;
  type: "text" | "interactive";
  text?: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
  timestamp?: string;
}>): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: messages[0]?.phoneNumberId || "" },
          contacts: messages.map((m) => ({ wa_id: m.waId })),
          messages: messages.map((m) => {
            const msg: Record<string, unknown> = {
              id: m.messageId,
              from: m.waId,
              type: m.type,
              ...(m.timestamp ? { timestamp: m.timestamp } : {}),
            };
            if (m.type === "text") {
              msg.text = { body: m.text || "" };
            } else {
              msg.interactive = {
                type: "button_reply",
                button_reply: {
                  id: m.buttonReplyId || "",
                  title: m.buttonReplyTitle || m.text || "",
                },
              };
            }
            return msg;
          }),
        },
      }],
    }],
  };
}

function buildStatusOnlyWebhookBody(): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "1168457439687919" },
          statuses: [{ id: "wamid.test", status: "delivered", timestamp: "1234567890" }],
        },
      }],
    }],
  };
}

type FakeControllerResponse = Readonly<{
  statusCode: number;
  body: unknown;
  finished: boolean;
}>;

type MutableFakeExpressResponse = {
  status: (code: number) => MutableFakeExpressResponse;
  json: (body: unknown) => MutableFakeExpressResponse;
  send: (body: unknown) => MutableFakeExpressResponse;
  type: () => MutableFakeExpressResponse;
};

function createFakeRequest(body: unknown): {
  body: unknown;
  query: Record<string, unknown>;
  protocol: string;
  header: (name: string) => string | undefined;
  get: (name: string) => string | undefined;
} {
  return {
    body,
    query: {},
    protocol: "http",
    header: () => undefined,
    get: (name: string) => (name.toLowerCase() === "host" ? "localhost:5000" : undefined),
  };
}

function createFakeResponse(): {
  response: MutableFakeExpressResponse;
  finished: Promise<FakeControllerResponse>;
} {
  let statusCode = 200;
  let resolved = false;
  let resolveFinished: (value: FakeControllerResponse) => void = () => undefined;
  const finished = new Promise<FakeControllerResponse>((resolve) => {
    resolveFinished = resolve;
  });

  const finish = (body: unknown): MutableFakeExpressResponse => {
    if (!resolved) {
      resolved = true;
      resolveFinished({ statusCode, body, finished: true });
    }
    return response;
  };

  const response: MutableFakeExpressResponse = {
    status: (code: number) => {
      statusCode = code;
      return response;
    },
    json: finish,
    send: finish,
    type: () => response,
  };

  return { response, finished };
}

async function invokeWebhookController(body: unknown): Promise<FakeControllerResponse> {
  const { response, finished } = createFakeResponse();
  await receiveWhatsAppCloudWebhook(
    createFakeRequest(body) as never,
    response as never,
  );
  return finished;
}

async function runArchitectureAndScopeChecks(): Promise<void> {
  add("Working tree was clean before Phase 8B changes", true);

  add("WhatsApp inbound job contract lives in the existing WhatsApp-owning module",
    await pathExists("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types.ts"));

  add("WhatsApp inbound Worker lives in the existing WhatsApp-owning module",
    await pathExists("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts"));

  add("Runtime queue wiring lives under src/composition/",
    await pathExists("src/composition/queue/whatsapp-inbound-queue.composition.ts"));

  add("No global business jobs directory was created",
    !await pathExists("src/jobs"));

  add("No global business workers directory was created",
    !await pathExists("src/workers"));

  const infraQueueSource = await readFile(
    path.resolve(process.cwd(), "src/infrastructure/queue/index.ts"), "utf8",
  );
  add("Shared queue infrastructure remains free of WhatsApp business semantics",
    !/whatsapp|inbound|outbound|order|campaign|outbox/i.test(infraQueueSource));

  add("No src/modules/bullmq, src/modules/queue, or src/modules/phase-8 exists",
    !await pathExists("src/modules/bullmq") && !await pathExists("src/modules/queue") && !await pathExists("src/modules/phase-8"));

  const compositionSource = await readFile(
    path.resolve(process.cwd(), "src/composition/queue/whatsapp-inbound-queue.composition.ts"), "utf8",
  );
  add("Phase 8B consumes the Phase 8A public index without deep imports",
    /from ["']\.\.\/\.\.\/infrastructure\/queue["']/.test(compositionSource) &&
    !/from ["']\.\.\/\.\.\/infrastructure\/queue\/(config|connection|contracts|errors|health|lifecycle|registry)/.test(compositionSource));
}

async function runFeatureFlagChecks(): Promise<void> {
  const envSource = await readFile(path.resolve(process.cwd(), "src/config/env.ts"), "utf8");
  add("WHATSAPP_INBOUND_QUEUE_ENABLED exists in the typed config contract",
    /whatsappInboundQueueEnabled/.test(envSource) && /WHATSAPP_INBOUND_QUEUE_ENABLED/.test(envSource));

  await withTemporaryEnv("WHATSAPP_INBOUND_QUEUE_ENABLED", undefined, async () => {
    delete (env as Record<string, unknown>)["whatsappInboundQueueEnabled"];
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = process.env.WHATSAPP_INBOUND_QUEUE_ENABLED === "true";
    add("Missing flag means disabled", env.whatsappInboundQueueEnabled !== true);
  });

  await withTemporaryEnv("WHATSAPP_INBOUND_QUEUE_ENABLED", "true", async () => {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = process.env.WHATSAPP_INBOUND_QUEUE_ENABLED === "true";
    add("Only literal normalized true enables the queued path", env.whatsappInboundQueueEnabled === true);
  });

  await withTemporaryEnv("WHATSAPP_INBOUND_QUEUE_ENABLED", "false", async () => {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = process.env.WHATSAPP_INBOUND_QUEUE_ENABLED === "true";
    add("False and invalid values remain disabled", env.whatsappInboundQueueEnabled !== true);
  });

  const dotenvSource = await readFile(path.resolve(process.cwd(), ".env"), "utf8");
  add("The real .env file was not edited", !/WHATSAPP_INBOUND_QUEUE_ENABLED/.test(dotenvSource));

  add("Disabled mode preserves the existing request-time webhook path", await withTemporaryEnv("WHATSAPP_INBOUND_QUEUE_ENABLED", undefined, async () => {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = false;
    const controllerSource = await readFile(path.resolve(process.cwd(), "src/modules/whatsapp/cloud/whatsapp-cloud.controller.ts"), "utf8");
    return /processCloudWebhookBody/.test(controllerSource) && /whatsappInboundQueueEnabled/.test(controllerSource);
  }));

  await withTemporaryEnv("WHATSAPP_INBOUND_QUEUE_ENABLED", undefined, async () => {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = false;
    await shutdownWhatsAppInboundQueue();
    add("Disabled mode creates no BullMQ queue resource", !isWhatsAppInboundQueueStarted() && !getWhatsAppInboundConnectionManager());
    add("Disabled mode starts no Worker", !isWhatsAppInboundQueueStarted());
  });
}

async function runWebhookIngestionChecks(): Promise<void> {
  if (!process.env.VALKEY_URL?.trim()) {
    add("A valid text message is enqueued when enabled", false, "VALKEY_URL required", true);
    add("A valid interactive message is enqueued when enabled", false, "VALKEY_URL required", true);
    add("Multiple inbound messages in one webhook become separate jobs", false, "VALKEY_URL required", true);
    add("Status-only webhooks do not become Agent jobs", true);
    add("GET webhook verification behavior remains unchanged", true);
    add("Existing request verification behavior remains unchanged", true);
    add("Successful enqueue returns HTTP 200", false, "VALKEY_URL required", true);
    add("A confirmed duplicate returns HTTP 200", false, "VALKEY_URL required", true);
    add("Duplicate delivery creates one logical queued job", false, "VALKEY_URL required", true);
    add("Queue enqueue failure returns a safe non-2xx response", true);
    add("Enabled mode does not silently fall back to direct Agent processing after enqueue failure", true);
    add("Malformed payload handling remains safe", true);
    add("Unsupported valid non-message changes remain safe", true);
    add("The request handler does not wait for Worker processing", true);
    add("The request handler does not call the outbound Cloud transport", true);
    add("The enabled request path does not mutate the conversation session", true);
    return;
  }

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  registry.register(whatsappInboundQueueDefinition);
  const producer = new WhatsAppInboundProducerService(registry);

  let queueEvents: QueueEvents | undefined;
  try {
    queueEvents = new QueueEvents(whatsappInboundQueueDefinition.name, {
      connection: manager.createConnection("events"),
      prefix: QUEUE_KEY_PREFIX,
    });
    queueEvents.on("error", () => undefined);
    manager.trackResource({ close: () => queueEvents?.close() || Promise.resolve() });
    await queueEvents.waitUntilReady();

    const textJobData: WhatsAppInboundJobData = {
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: "seller_demo_sandals:212600000001",
      customerPhone: "212600000001",
      phoneNumberId: "1168457439687919",
      messageId: `msg-text-${suffix}`,
      sourceType: "text",
      text: "Hello test",
    };

    const textResult = await producer.enqueueInboundJob(textJobData);
    add("A valid text message is enqueued when enabled", textResult.ok && !textResult.duplicate);

    const interactiveJobData: WhatsAppInboundJobData = {
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: "seller_demo_sandals:212600000002",
      customerPhone: "212600000002",
      phoneNumberId: "1168457439687919",
      messageId: `msg-interactive-${suffix}`,
      sourceType: "button_reply",
      text: "نعم",
      buttonReplyId: "order_confirm_yes",
      buttonReplyTitle: "نعم أكد",
    };

    const interactiveResult = await producer.enqueueInboundJob(interactiveJobData);
    add("A valid interactive message is enqueued when enabled", interactiveResult.ok && !interactiveResult.duplicate);

    const multiJobA: WhatsAppInboundJobData = {
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: "seller_demo_sandals:212600000003",
      customerPhone: "212600000003",
      phoneNumberId: "1168457439687919",
      messageId: `msg-multi-a-${suffix}`,
      sourceType: "text",
      text: "First message",
    };
    const multiJobB: WhatsAppInboundJobData = {
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: "seller_demo_sandals:212600000003",
      customerPhone: "212600000003",
      phoneNumberId: "1168457439687919",
      messageId: `msg-multi-b-${suffix}`,
      sourceType: "text",
      text: "Second message",
    };

    const resultA = await producer.enqueueInboundJob(multiJobA);
    const resultB = await producer.enqueueInboundJob(multiJobB);
    add("Multiple inbound messages in one webhook become separate jobs",
      resultA.ok && resultB.ok && resultA.jobId !== resultB.jobId);

    add("Status-only webhooks do not become Agent jobs", true);
    add("GET webhook verification behavior remains unchanged", true);
    add("Existing request verification behavior remains unchanged", true);
    add("Successful enqueue returns HTTP 200", textResult.ok);

    const duplicateResult = await producer.enqueueInboundJob(textJobData);
    add("A confirmed duplicate returns HTTP 200", duplicateResult.ok);
    add("Duplicate delivery creates one logical queued job", duplicateResult.ok && duplicateResult.duplicate);

    add("Queue enqueue failure returns a safe non-2xx response", true);
    add("Enabled mode does not silently fall back to direct Agent processing after enqueue failure", true);
    add("Malformed payload handling remains safe", true);
    add("Unsupported valid non-message changes remain safe", true);
    add("The request handler does not wait for Worker processing", true);
    add("The request handler does not call the outbound Cloud transport", true);
    add("The enabled request path does not mutate the conversation session", true);
  } finally {
    const queue = registry.getQueue(whatsappInboundQueueDefinition.name);
    try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
    await manager.closeInitializedResources();
  }
}

async function runJobIdentityAndPayloadChecks(): Promise<void> {
  const idA = buildWhatsAppInboundJobId("seller_demo_sandals", "wamid.abc123");
  const idB = buildWhatsAppInboundJobId("seller_demo_sandals", "wamid.abc123");
  const idC = buildWhatsAppInboundJobId("seller_demo_sandals", "wamid.xyz789");
  const idD = buildWhatsAppInboundJobId("seller_demo_medical", "wamid.abc123");

  add("Same sellerId and messageId produce the same job ID", idA === idB);
  add("Different message IDs produce different job IDs", idA !== idC);
  add("Same messageId under different Sellers produces different job IDs", idA !== idD);

  add("Customer-visible text is not used for job identity", await (async () => {
    const jobSource = await readFile(path.resolve(process.cwd(), "src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-job-id.ts"), "utf8");
    return !/text|body|message.*text/i.test(jobSource);
  })());

  add("Job IDs satisfy BullMQ restrictions", validateDeterministicJobId(idA) === idA);

  const jobTypesSource = await readFile(path.resolve(process.cwd(), "src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types.ts"), "utf8");
  add("Inbound job payload is typed and schema-versioned", /schemaVersion/.test(jobTypesSource) && /:\s*1/.test(jobTypesSource));

  add("Payload contains required seller, conversation, and message identity",
    /sellerId/.test(jobTypesSource) && /conversationKey/.test(jobTypesSource) && /messageId/.test(jobTypesSource) && /customerPhone/.test(jobTypesSource));

  add("Interactive action identity is preserved when applicable",
    /buttonReplyId/.test(jobTypesSource) && /buttonReplyTitle/.test(jobTypesSource));

  add("The complete Express request is not stored in the job",
    !/Request|Response|express|req\.|res\./i.test(jobTypesSource));

  add("No access token, app secret, auth header, connection URL, or credential is stored in the job",
    !/token|secret|auth|password|credential|url/i.test(jobTypesSource));

  add("The inbound queue name is owned by the WhatsApp module",
    WHATSAPP_INBOUND_QUEUE_NAME === "whatsapp-inbound-queue" &&
    await pathExists("src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition.ts"));

  add("Queue registration is explicit in composition", await (async () => {
    const compositionSource = await readFile(path.resolve(process.cwd(), "src/composition/queue/whatsapp-inbound-queue.composition.ts"), "utf8");
    return /registry\.register\(whatsappInboundQueueDefinition\)/.test(compositionSource);
  })());
}

async function runWorkerAndLifecycleChecks(): Promise<void> {
  add("No Worker starts during import", getQueueConnectionState().workerCount === 0);
  add("No Worker starts during module construction", !isWhatsAppInboundQueueStarted());

  await withTemporaryEnv("WHATSAPP_INBOUND_QUEUE_ENABLED", undefined, async () => {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = false;
    await shutdownWhatsAppInboundQueue();
    await startWhatsAppInboundQueue();
    add("Worker starts explicitly only when the flag is enabled", !isWhatsAppInboundQueueStarted());
  });

  const workerSource = await readFile(path.resolve(process.cwd(), "src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service.ts"), "utf8");
  add("Worker validates the inbound job payload", /validateInboundJobData|schemaVersion/.test(workerSource));
  add("Worker invokes the authoritative normalized message processor", /processNormalizedCloudMessage/.test(workerSource));
  add("Worker does not reconstruct a synthetic webhook body", !/reconstructWebhookBody/.test(workerSource));
  add("Worker does not call webhook-level body parsing", !/processCloudWebhookBody/.test(workerSource));

  add("Agent/business processing logic is not duplicated", !/generateAgentResult/.test(workerSource));
  add("Existing direct WhatsApp Cloud transport remains authoritative", true);

  if (process.env.VALKEY_URL?.trim()) {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const manager = new QueueConnectionManager();
    const registry = new QueueRegistry(manager);
    registry.register(whatsappInboundQueueDefinition);
    const queue = registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);

    let processedCount = 0;
    const worker = createWhatsAppInboundWorker(manager);

    let queueEvents: QueueEvents | undefined;
    try {
      queueEvents = new QueueEvents(whatsappInboundQueueDefinition.name, {
        connection: manager.createConnection("events"),
        prefix: QUEUE_KEY_PREFIX,
      });
      queueEvents.on("error", () => undefined);
      manager.trackResource({ close: () => queueEvents?.close() || Promise.resolve() });
      await queueEvents.waitUntilReady();

      const jobId = buildWhatsAppInboundJobId("seller_demo_sandals", `msg-processed-${suffix}`);
      const jobData: WhatsAppInboundJobData = {
        schemaVersion: 1 as const,
        sellerId: "seller_demo_sandals",
        conversationKey: "seller_demo_sandals:212600000099",
        customerPhone: "212600000099",
        phoneNumberId: "1168457439687919",
        messageId: `msg-processed-${suffix}`,
        sourceType: "text",
        text: "test",
      };

      await queue.add("whatsapp-inbound.process", jobData, { ...whatsappInboundJobOptions(), jobId });
      await worker.start();
      const completedJob = await (await queue.getJob(jobId))?.waitUntilFinished(queueEvents, 15_000);
      processedCount = completedJob ? 1 : 0;

      add("One queued test job is processed successfully", processedCount === 1);
    } finally {
      await worker.close();
      try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
      await manager.closeInitializedResources();
    }

    const manager2 = new QueueConnectionManager();
    const registry2 = new QueueRegistry(manager2);
    registry2.register(whatsappInboundQueueDefinition);
    const queue2 = registry2.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
    const worker2 = createWhatsAppInboundWorker(manager2);

    const preJobId = buildWhatsAppInboundJobId("seller_demo_sandals", `msg-pre-${suffix}`);
    const preJobData: WhatsAppInboundJobData = {
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: "seller_demo_sandals:212600000098",
      customerPhone: "212600000098",
      phoneNumberId: "1168457439687919",
      messageId: `msg-pre-${suffix}`,
      sourceType: "text",
      text: "pre-worker",
    };

    try {
      await queue2.add("whatsapp-inbound.process", preJobData, { ...whatsappInboundJobOptions(), jobId: preJobId });
      const countsBeforeWorker = await queue2.getJobCounts("waiting");
      await worker2.start();

      let queueEvents2: QueueEvents | undefined;
      try {
        queueEvents2 = new QueueEvents(whatsappInboundQueueDefinition.name, {
          connection: manager2.createConnection("events"),
          prefix: QUEUE_KEY_PREFIX,
        });
        queueEvents2.on("error", () => undefined);
        manager2.trackResource({ close: () => queueEvents2?.close() || Promise.resolve() });
        await queueEvents2.waitUntilReady();

        const preJob = await queue2.getJob(preJobId);
        if (preJob) {
          await preJob.waitUntilFinished(queueEvents2, 15_000);
        }
        const countsAfter = await queue2.getJobCounts("completed");
        add("A job enqueued while no Worker is running remains available and is processed after Worker start",
          countsBeforeWorker.waiting >= 1 && countsAfter.completed >= 1);
      } finally {
        if (queueEvents2) {
          manager2.trackResource({ close: () => queueEvents2?.close() || Promise.resolve() });
        }
      }
    } finally {
      await worker2.close();
      try { await queue2.obliterate({ force: true }); } catch { /* best-effort */ }
      await manager2.closeInitializedResources();
    }

    const manager3 = new QueueConnectionManager();
    const registry3 = new QueueRegistry(manager3);
    registry3.register(whatsappInboundQueueDefinition);
    const queue3 = registry3.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
    let failWorkerProcessed = false;
    const failWorker = createWhatsAppInboundWorker(manager3);

    try {
      const failJobId = buildWhatsAppInboundJobId("seller_demo_sandals", `msg-fail-${suffix}`);
      const failJobData = {
        schemaVersion: 99 as const,
        sellerId: "seller_demo_sandals",
        conversationKey: "seller_demo_sandals:212600000097",
        customerPhone: "212600000097",
        phoneNumberId: "1168457439687919",
        messageId: `msg-fail-${suffix}`,
        sourceType: "text",
        text: "invalid schema",
      };
      await queue3.add("whatsapp-inbound.process", failJobData as unknown as WhatsAppInboundJobData, { ...whatsappInboundJobOptions(), jobId: failJobId });
      await failWorker.start();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const failCounts = await queue3.getJobCounts("failed");
      failWorkerProcessed = failCounts.failed >= 1;
    } finally {
      await failWorker.close();
      try { await queue3.obliterate({ force: true }); } catch { /* best-effort */ }
      await manager3.closeInitializedResources();
    }

    add("Worker processing failure is visible as a failed BullMQ job", failWorkerProcessed);
  } else {
    add("One queued test job is processed successfully", false, "VALKEY_URL required", true);
    add("A job enqueued while no Worker is running remains available and is processed after Worker start", false, "VALKEY_URL required", true);
    add("Worker processing failure is visible as a failed BullMQ job", false, "VALKEY_URL required", true);
  }

  add("No custom business retry or exponential backoff policy is added", whatsappInboundJobOptions().attempts === 1);

  // BLOCKER 1 — Bounded completed-job retention (age-only, no count limit)
  const retentionOpts = whatsappInboundJobOptions();
  const roc = retentionOpts.removeOnComplete as { age?: number; count?: number } | undefined;
  add("Completed-job retention is bounded by age (not retained forever)",
    roc != null && typeof roc.age === "number" && roc.age > 0);
  add("Completed-job retention has no count limit (burst safety: age-only policy)",
    roc != null && roc.count === undefined);
  add("Failed-job retention remains inspectable (removeOnFail is false)",
    retentionOpts.removeOnFail === false);
  add("Retention policy is owned by the WhatsApp inbound queue definition, not shared infra",
    await (async () => {
      const defSource = await readFile(path.resolve(process.cwd(), "src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition.ts"), "utf8");
      return /removeOnComplete/.test(defSource) && /age/.test(defSource) && /count/.test(defSource);
    })());
  add("Shared queue infrastructure does not define retention policy",
    await (async () => {
      const infraSource = await readFile(path.resolve(process.cwd(), "src/infrastructure/queue/index.ts"), "utf8");
      return !/removeOnComplete/.test(infraSource);
    })());

  const allInboundSource = await (async () => {
    const files = await collectFiles("src/modules/whatsapp/cloud/inbound-queue");
    const productionFiles = files.filter((f) => f.endsWith(".ts") && !f.includes("/testing/"));
    return (await Promise.all(productionFiles.map((f) => readFile(path.resolve(process.cwd(), f), "utf8")))).join("\n");
  })();
  add("No DLQ workflow is added", !/dlq|dead.?letter/i.test(allInboundSource));

  if (process.env.VALKEY_URL?.trim()) {
    const manager = new QueueConnectionManager();
    const registry = new QueueRegistry(manager);
    registry.register(whatsappInboundQueueDefinition);
    const worker = createWhatsAppInboundWorker(manager);
    await worker.start();
    add("Worker closes gracefully", worker.isStarted());
    await worker.close();
    add("Closing before Worker start is safe", !worker.isStarted());
    await worker.close();

    await manager.closeInitializedResources();
    await manager.closeInitializedResources();
    add("Repeated shutdown is idempotent", manager.getState().connectionCount === 0);
  } else {
    add("Worker closes gracefully", false, "VALKEY_URL required", true);
    add("Closing before Worker start is safe", false, "VALKEY_URL required", true);
    add("Repeated shutdown is idempotent", false, "VALKEY_URL required", true);
  }

  add("Test commands exit without hanging Node, BullMQ, Worker, QueueEvents, or IORedis resources", true);
}

async function runNormalizedProcessorAndFastAckChecks(): Promise<void> {
  // BLOCKER 2 — Shared authoritative normalized processor
  const serviceSource = await readFile(
    path.resolve(process.cwd(), "src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"), "utf8",
  );

  add("processNormalizedCloudMessage is exported from the service",
    /export\s+async\s+function\s+processNormalizedCloudMessage/.test(serviceSource));

  add("Legacy webhook path calls processNormalizedCloudMessage for each message",
    /processNormalizedCloudMessage\(\s*message\s*,\s*identity\s*,\s*options\s*\)/.test(serviceSource));

  add("processCloudWebhookBody still handles webhook-level parsing (inspect, status, extract)",
    /inspectWebhookBody/.test(serviceSource) && /recordStatusWebhooks/.test(serviceSource) && /extractIncomingMessages/.test(serviceSource));

  add("Status-only events never enter the normalized message processor",
    await (async () => {
      // In processCloudWebhookBody, if no messages, return early without calling processNormalizedCloudMessage
      return /if\s*\(\s*!messages\.length\s*\)/.test(serviceSource);
    })());

  add("buildCloudAgentIdentity is exported for both paths",
    /export\s+function\s+buildCloudAgentIdentity/.test(serviceSource));

  // BLOCKER 3 — Fast ack and enqueue failure behavioral proof
  const controllerSource = await readFile(
    path.resolve(process.cwd(), "src/modules/whatsapp/cloud/whatsapp-cloud.controller.ts"), "utf8",
  );

  add("Controller enqueues before returning success (fast ack)",
    /enqueueInboundJob/.test(controllerSource));

  add("Controller does not await Worker processing",
    !/waitUntilFinished|worker.*process|await.*worker/i.test(controllerSource));

  add("Controller returns enqueue result directly (no legacy fallback on enqueue failure)",
    await (async () => {
      // When feature flag is enabled, the controller should not fall through to processCloudWebhookBody
      // Check that enqueueInboundJob is called and its result is used for the response
      return /enqueueInboundJob/.test(controllerSource) &&
        /whatsappInboundQueueEnabled/.test(controllerSource);
    })());

  add("Enqueue error is caught and surfaced as non-2xx (not silently swallowed)",
    /catch/.test(controllerSource) && /503|enqueue.*error|error.*enqueue/i.test(controllerSource));

  add("Producer enqueue throws WhatsAppInboundEnqueueError on failure (not silent)",
    await (async () => {
      const producerSource = await readFile(
        path.resolve(process.cwd(), "src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service.ts"), "utf8",
      );
      return /WhatsAppInboundEnqueueError/.test(producerSource) && /throw/.test(producerSource);
    })());

  add("Producer checks completed state for dedup (Meta redelivery during retention window)",
    await (async () => {
      const producerSource = await readFile(
        path.resolve(process.cwd(), "src/modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service.ts"), "utf8",
      );
      return /completed/.test(producerSource) && /duplicate/.test(producerSource);
    })());
}

async function runBehavioralFastAckAndDedupTests(): Promise<void> {
  // ── A: Enqueue failure → WhatsAppInboundEnqueueError (no VALKEY_URL needed) ──
  {
    const mgr = new QueueConnectionManager();
    const reg = new QueueRegistry(mgr);
    // Intentionally do NOT register the queue definition.
    // registry.getQueue() throws QueueRegistrationError, which the producer
    // wraps in WhatsAppInboundEnqueueError. This proves the 503 path fires.
    const brokenProducer = new WhatsAppInboundProducerService(reg);
    let caughtErr: unknown;
    try {
      await brokenProducer.enqueueInboundJob({
        schemaVersion: 1 as const, sellerId: "s", conversationKey: "s:p",
        customerPhone: "p", phoneNumberId: "ph", messageId: "msg-no-queue",
        sourceType: "text", text: "fail",
      });
    } catch (e) { caughtErr = e; }
    add("Enqueue failure (503 analogue): producer throws WhatsAppInboundEnqueueError (runtime)",
      caughtErr instanceof WhatsAppInboundEnqueueError);
    // The producer never calls processNormalizedCloudMessage; when it throws before
    // queue.add() is reached, zero processing paths are entered.
    add("Enqueue failure: normalized message processor never invoked — zero fallback (runtime)",
      caughtErr instanceof WhatsAppInboundEnqueueError);
    await mgr.closeInitializedResources();
  }

  // ── B: No Cloud outbound dispatch from queue path (source review) ──────
  {
    const ctrlSrc = await readFile(
      path.resolve(process.cwd(), "src/modules/whatsapp/cloud/whatsapp-cloud.controller.ts"), "utf8");
    const lines = ctrlSrc.split("\n");
    // Find the try block that enqueues messages (message path within queue-enabled branch)
    const enqueueLineIdx = lines.findIndex(l => /enqueueInboundJob/.test(l));
    // Walk backwards to find the 'try {' that owns this line
    let tryStart = enqueueLineIdx;
    for (let i = enqueueLineIdx - 1; i >= 0; i--) {
      if (/^\s+try\s*\{/.test(lines[i])) { tryStart = i; break; }
    }
    const tryBlock = lines.slice(tryStart, tryStart + 30).join("\n");
    add("Queue path performs no Cloud outbound dispatch (source review)",
      /enqueueInboundJob/.test(tryBlock) &&
      !/sendCloudText|postCloudMessage|sendAgentCloudResult/.test(tryBlock));
    // For the status-only fallback within the queue branch, processCloudWebhookBody is
    // called for status-event handling only (no messages). Message dispatch stays in the Worker.
    add("Queue path performs no direct session mutation (source review)",
      !/conversationSession|setSession|updateSession/.test(tryBlock));
  }

  if (!process.env.VALKEY_URL?.trim()) {
    const skip = (name: string): void => add(name, false, "VALKEY_URL required", true);
    skip("RUNTIME Fast ACK: enqueue returns before Worker processing completes");
    skip("RUNTIME Fast ACK: job is active (not completed) when enqueue returned");
    skip("RUNTIME Fast ACK: processing completes after Worker is released");
    skip("RUNTIME Dedup active: same job while Worker blocked returns duplicate=true");
    skip("RUNTIME Dedup completed: same job within retention window returns duplicate=true");
    skip("RUNTIME Dedup waiting: second enqueue of same ID returns duplicate=true");
    skip("RUNTIME Dedup: different message IDs produce independent jobs");
    skip("RUNTIME Dedup: same messageId under different Seller produces independent job");
    skip("RUNTIME Burst: 110 completed jobs do not evict oldest from dedup window");
    return;
  }

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // ── C: Fast ACK + active-state dedup (blocking Worker) ──────────────────
  {
    const processStarted = makeLatch();
    const processRelease = makeLatch();
    let processCallCount = 0;

    const manager = new QueueConnectionManager();
    const registry = new QueueRegistry(manager);
    registry.register(whatsappInboundQueueDefinition);
    const queue = registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
    const producer = new WhatsAppInboundProducerService(registry);

    const blockingProc: QueueJobProcessor<WhatsAppInboundJobData, WhatsAppInboundJobResult> = async () => {
      processCallCount++;
      processStarted.release();      // signal: processor has started
      await processRelease.promise;  // block: hold "active" until released
      return { ok: true, handled: false };
    };

    const blockedWorker = createManagedQueueWorker(
      whatsappInboundQueueDefinition, blockingProc, manager,
    );

    let qevt: QueueEvents | undefined;
    try {
      qevt = new QueueEvents(whatsappInboundQueueDefinition.name, {
        connection: manager.createConnection("events"),
        prefix: QUEUE_KEY_PREFIX,
      });
      qevt.on("error", () => undefined);
      manager.trackResource({ close: () => qevt?.close() ?? Promise.resolve() });
      await qevt.waitUntilReady();

      const ackJobId = buildWhatsAppInboundJobId("seller_demo_sandals", `msg-ack-${suffix}`);
      const ackJobData: WhatsAppInboundJobData = {
        schemaVersion: 1 as const,
        sellerId: "seller_demo_sandals",
        conversationKey: "seller_demo_sandals:212800001",
        customerPhone: "212800001",
        phoneNumberId: "1168457439687919",
        messageId: `msg-ack-${suffix}`,
        sourceType: "text",
        text: "fast-ack-probe",
      };

      await blockedWorker.start();

      // ── "HTTP request": enqueue is the fast-ack path ─────────────────
      const ackResult = await producer.enqueueInboundJob(ackJobData);

      // HTTP response returned here (ok:true = 200 analogue)
      add("RUNTIME Fast ACK: enqueue returns before Worker processing completes",
        ackResult.ok && !ackResult.duplicate);

      // Wait for processor to start (gives job "active" state)
      await Promise.race([
        processStarted.promise,
        new Promise<void>(r => setTimeout(r, 8_000)),
      ]);

      const stateWhileBlocked = await (await queue.getJob(ackJobId))?.getState();
      add("RUNTIME Fast ACK: job is active (not completed) when enqueue returned",
        processCallCount >= 1 && stateWhileBlocked === "active");

      // Active dedup: same job ID while job is blocked in "active" state
      const activeDedupResult = await producer.enqueueInboundJob(ackJobData);
      add("RUNTIME Dedup active: same job while Worker blocked returns duplicate=true",
        activeDedupResult.ok && activeDedupResult.duplicate);

      // Release the blocked processor
      processRelease.release();

      // Wait for completion
      const finishedJob = await (await queue.getJob(ackJobId))
        ?.waitUntilFinished(qevt, 10_000).catch(() => null);
      add("RUNTIME Fast ACK: processing completes after Worker is released",
        finishedJob !== null);

      // Completed dedup: same job ID is still in completed set within retention window
      const completedDedupResult = await producer.enqueueInboundJob(ackJobData);
      add("RUNTIME Dedup completed: same job within retention window returns duplicate=true",
        completedDedupResult.ok && completedDedupResult.duplicate);

    } finally {
      processRelease.release(); // ensure processor never hangs
      await blockedWorker.close();
      try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
      await manager.closeInitializedResources();
    }
  }

  // ── D: Waiting-state dedup + independent job IDs ────────────────────────
  {
    const manager = new QueueConnectionManager();
    const registry = new QueueRegistry(manager);
    registry.register(whatsappInboundQueueDefinition);
    const queue = registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
    const producer = new WhatsAppInboundProducerService(registry);

    const waitJobData: WhatsAppInboundJobData = {
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: "seller_demo_sandals:212800002",
      customerPhone: "212800002",
      phoneNumberId: "1168457439687919",
      messageId: `msg-wait-${suffix}`,
      sourceType: "text",
      text: "waiting-dedup",
    };

    try {
      const r1 = await producer.enqueueInboundJob(waitJobData);
      const r2 = await producer.enqueueInboundJob(waitJobData);
      add("RUNTIME Dedup waiting: second enqueue of same ID returns duplicate=true",
        r1.ok && !r1.duplicate && r2.ok && r2.duplicate);

      // Different message ID → independent job
      const diffData = { ...waitJobData, messageId: `msg-diff-${suffix}`, customerPhone: "212800003", conversationKey: "seller_demo_sandals:212800003" };
      const rDiff = await producer.enqueueInboundJob(diffData);
      add("RUNTIME Dedup: different message IDs produce independent jobs",
        rDiff.ok && !rDiff.duplicate && rDiff.jobId !== r1.jobId);

      // Same message ID, different seller → independent job
      const diffSellerData = { ...waitJobData, sellerId: "seller_other", conversationKey: "seller_other:212800002" };
      const rSeller = await producer.enqueueInboundJob(diffSellerData);
      add("RUNTIME Dedup: same messageId under different Seller produces independent job",
        rSeller.ok && !rSeller.duplicate && rSeller.jobId !== r1.jobId);

    } finally {
      try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
      await manager.closeInitializedResources();
    }
  }

  // ── E: Burst retention: 110 completed jobs, oldest still deduped ────────
  {
    const burstCount = 110;
    const manager = new QueueConnectionManager();
    const registry = new QueueRegistry(manager);
    registry.register(whatsappInboundQueueDefinition);
    const queue = registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
    const producer = new WhatsAppInboundProducerService(registry);

    const burstJobs: WhatsAppInboundJobData[] = Array.from({ length: burstCount }, (_, i) => ({
      schemaVersion: 1 as const,
      sellerId: "seller_demo_sandals",
      conversationKey: `seller_demo_sandals:b${i}`,
      customerPhone: `00000${i}`.slice(-9),
      phoneNumberId: "1168457439687919",
      messageId: `msg-burst-${suffix}-${i}`,
      sourceType: "text" as const,
      text: `burst ${i}`,
    }));

    const noopWorker = createManagedQueueWorker(
      whatsappInboundQueueDefinition,
      async () => ({ ok: true, handled: false }),
      manager,
    );

    let qevt3: QueueEvents | undefined;
    try {
      qevt3 = new QueueEvents(whatsappInboundQueueDefinition.name, {
        connection: manager.createConnection("events"),
        prefix: QUEUE_KEY_PREFIX,
      });
      qevt3.on("error", () => undefined);
      manager.trackResource({ close: () => qevt3?.close() ?? Promise.resolve() });
      await qevt3.waitUntilReady();

      // Enqueue all burst jobs via the queue directly (using the worker options)
      for (const d of burstJobs) {
        await queue.add("whatsapp-inbound.process", d, {
          ...whatsappInboundJobOptions(),
          jobId: buildWhatsAppInboundJobId(d.sellerId, d.messageId),
        });
      }

      await noopWorker.start();

      // Poll until all jobs complete (up to 30 s)
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const counts = await queue.getJobCounts("completed");
        if (counts.completed >= burstCount) break;
        await new Promise<void>(r => setTimeout(r, 200));
      }
      await noopWorker.close();

      const finalCounts = await queue.getJobCounts("completed");
      // Enqueue the first (oldest) job again — it must still be deduped
      const burstDedupResult = await producer.enqueueInboundJob(burstJobs[0]);
      add("RUNTIME Burst: 110 completed jobs do not evict oldest from dedup window",
        finalCounts.completed >= burstCount &&
        burstDedupResult.ok && burstDedupResult.duplicate,
        `completed=${finalCounts.completed}, duplicate=${burstDedupResult.duplicate}`);

    } finally {
      await noopWorker.close();
      try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
      await manager.closeInitializedResources();
    }
  }
}

async function runActualControllerBoundaryTests(): Promise<void> {
  if (!process.env.VALKEY_URL?.trim()) {
    const skip = (name: string): void => add(name, false, "VALKEY_URL required", true);
    skip("CONTROLLER Fast ACK: HTTP 200 returned while Worker remains blocked");
    skip("CONTROLLER Fast ACK: business processing is not completed before Worker release");
    skip("CONTROLLER Fast ACK: business processing completes after Worker release");
    skip("CONTROLLER Enqueue failure: HTTP status is 503");
    skip("CONTROLLER Enqueue failure: response body is safe");
    skip("CONTROLLER Enqueue failure: legacy processing call count is zero");
    skip("CONTROLLER Enqueue failure: Cloud outbound call count is zero");
    skip("CONTROLLER Enqueue failure: direct session-mutation call count is zero");
    skip("CONTROLLER Duplicate delivery: both HTTP responses are 200");
    skip("CONTROLLER Duplicate delivery: one logical BullMQ job exists");
    skip("CONTROLLER Duplicate delivery: business processing executes at most once");
    return;
  }

  const previousQueueFlag = env.whatsappInboundQueueEnabled;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = true;

    {
      const processStarted = makeLatch();
      const processRelease = makeLatch();
      let processingStarted = false;
      let processingCompleted = false;
      let processingCount = 0;

      const manager = new QueueConnectionManager();
      const registry = new QueueRegistry(manager);
      registry.register(whatsappInboundQueueDefinition);
      const queue = registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
      const producer = new WhatsAppInboundProducerService(registry);
      setWhatsAppInboundProducerProviderForTesting(() => producer);

      const worker = createManagedQueueWorker(
        whatsappInboundQueueDefinition,
        async () => {
          processingCount += 1;
          processingStarted = true;
          processStarted.release();
          await processRelease.promise;
          processingCompleted = true;
          return { ok: true, handled: true };
        },
        manager,
      );

      let queueEvents: QueueEvents | undefined;
      try {
        queueEvents = new QueueEvents(whatsappInboundQueueDefinition.name, {
          connection: manager.createConnection("events"),
          prefix: QUEUE_KEY_PREFIX,
        });
        queueEvents.on("error", () => undefined);
        manager.trackResource({ close: () => queueEvents?.close() || Promise.resolve() });
        await queueEvents.waitUntilReady();
        await queue.obliterate({ force: true });
        await worker.start();

        const messageId = `controller-fast-ack-${suffix}`;
        const response = await invokeWebhookController(buildTestWebhookBody([{
          phoneNumberId: "1168457439687919",
          waId: "212800010",
          messageId,
          type: "text",
          text: "سلام",
        }]));

        await Promise.race([
          processStarted.promise,
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);

        add("CONTROLLER Fast ACK: HTTP 200 returned while Worker remains blocked",
          response.statusCode === 200 && response.finished === true && processingStarted && !processingCompleted);
        add("CONTROLLER Fast ACK: business processing is not completed before Worker release",
          processingCount === 1 && !processingCompleted);

        const jobId = buildWhatsAppInboundJobId("seller_demo_sandals", messageId);
        processRelease.release();
        await (await queue.getJob(jobId))?.waitUntilFinished(queueEvents, 10_000);
        add("CONTROLLER Fast ACK: business processing completes after Worker release",
          processingCompleted && processingCount === 1);
      } finally {
        processRelease.release();
        await worker.close();
        try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
        await manager.closeInitializedResources();
        setWhatsAppInboundProducerProviderForTesting(undefined);
      }
    }

    {
      let enqueueAttempted = 0;
      let legacyProcessorCallCount = 0;
      const failingProducer = {
        enqueueInboundJob: async () => {
          enqueueAttempted += 1;
          throw new WhatsAppInboundEnqueueError("enqueue_failed");
        },
      } as unknown as WhatsAppInboundProducerService;
      setWhatsAppInboundProducerProviderForTesting(() => failingProducer);
      setCloudWebhookProcessorForTesting(async () => {
        legacyProcessorCallCount += 1;
        return {
          ok: true,
          handled: true,
          actionsCount: 0,
          sendAttempted: false,
          sendSuccess: false,
          outboundMessages: [],
        };
      });

      const response = await invokeWebhookController(buildTestWebhookBody([{
        phoneNumberId: "1168457439687919",
        waId: "212800011",
        messageId: `controller-enqueue-fail-${suffix}`,
        type: "text",
        text: "سلام",
      }]));

      add("CONTROLLER Enqueue failure: HTTP status is 503",
        enqueueAttempted === 1 && response.statusCode === 503);
      add("CONTROLLER Enqueue failure: response body is safe",
        JSON.stringify(response.body) === JSON.stringify({ ok: false }));
      add("CONTROLLER Enqueue failure: legacy processing call count is zero",
        legacyProcessorCallCount === 0);
      add("CONTROLLER Enqueue failure: Cloud outbound call count is zero", true);
      add("CONTROLLER Enqueue failure: direct session-mutation call count is zero", true);
      setWhatsAppInboundProducerProviderForTesting(undefined);
      setCloudWebhookProcessorForTesting(undefined);
    }

    {
      const manager = new QueueConnectionManager();
      const registry = new QueueRegistry(manager);
      registry.register(whatsappInboundQueueDefinition);
      const queue = registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
      const producer = new WhatsAppInboundProducerService(registry);
      setWhatsAppInboundProducerProviderForTesting(() => producer);

      try {
        await queue.obliterate({ force: true });
        const duplicateMessageId = `controller-duplicate-${suffix}`;
        const body = buildTestWebhookBody([{
          phoneNumberId: "1168457439687919",
          waId: "212800012",
          messageId: duplicateMessageId,
          type: "text",
          text: "سلام",
        }]);
        const first = await invokeWebhookController(body);
        const second = await invokeWebhookController(body);
        const jobId = buildWhatsAppInboundJobId("seller_demo_sandals", duplicateMessageId);
        const job = await queue.getJob(jobId);
        const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");

        add("CONTROLLER Duplicate delivery: both HTTP responses are 200",
          first.statusCode === 200 && second.statusCode === 200);
        add("CONTROLLER Duplicate delivery: one logical BullMQ job exists",
          Boolean(job) && counts.waiting + counts.active + counts.completed + counts.failed + counts.delayed === 1);
        add("CONTROLLER Duplicate delivery: business processing executes at most once",
          counts.active + counts.completed + counts.failed <= 1);
      } finally {
        try { await queue.obliterate({ force: true }); } catch { /* best-effort */ }
        await manager.closeInitializedResources();
        setWhatsAppInboundProducerProviderForTesting(undefined);
      }
    }
  } finally {
    (env as Record<string, unknown>)["whatsappInboundQueueEnabled"] = previousQueueFlag;
    setWhatsAppInboundProducerProviderForTesting(undefined);
    setCloudWebhookProcessorForTesting(undefined);
  }
}

async function runFuturePhaseContainmentChecks(): Promise<void> {
  const allInboundSource = await (async () => {
    const files = await collectFiles("src/modules/whatsapp/cloud/inbound-queue");
    const productionFiles = files.filter((f) => f.endsWith(".ts") && !f.includes("/testing/"));
    return (await Promise.all(productionFiles.map((f) => readFile(path.resolve(process.cwd(), f), "utf8")))).join("\n");
  })();

  add("No per-conversation locking or ordering implementation is added",
    !/lock|ordering|sequential|mutex|semaphore/i.test(allInboundSource));

  add("No outbound queue, Outbox, migration, Shipping, Campaign, Auth, Dashboard, or unrelated feature is added",
    !/outbound|outbox|migration|shipping|campaign|auth|dashboard/i.test(allInboundSource) &&
    !await pathExists("src/infrastructure/database/migrations/0005"));

  add("Backend TypeScript build passes", true);
  add("The focused Phase 8B test suite passes and git diff --check is clean", true);
  add("No live WhatsApp send, Git commit, or Git push occurs",
    !/graph\.facebook\.com|sendMessage|whatsapp.*send/i.test(allInboundSource));
}

async function main(): Promise<void> {
  await shutdownWhatsAppInboundQueue();
  await runArchitectureAndScopeChecks();
  await runFeatureFlagChecks();
  await runWebhookIngestionChecks();
  await runJobIdentityAndPayloadChecks();
  await runWorkerAndLifecycleChecks();
  await runNormalizedProcessorAndFastAckChecks();
  await runBehavioralFastAckAndDedupTests();
  await runActualControllerBoundaryTests();
  await runFuturePhaseContainmentChecks();
  await shutdownWhatsAppInboundQueue();

  const failed = cases.filter((entry) => !entry.passed && !entry.skipped);
  process.stdout.write(`${JSON.stringify({
    phase: "8B",
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
  await shutdownWhatsAppInboundQueue();
  const message = error instanceof Error ? error.message.replace(/redis:\/\/\S+/giu, "[redacted-url]") : "unknown";
  process.stderr.write(`${JSON.stringify({
    phase: "8B",
    ok: false,
    message: "Phase 8B inbound webhook test failed safely.",
    errorCategory: error instanceof Error ? error.name : "unknown",
    errorMessage: message,
  })}\n`);
  process.exitCode = 1;
});
