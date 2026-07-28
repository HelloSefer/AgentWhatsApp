import dotenv from "dotenv";
import type { Request, Response } from "express";
import { closeDatabasePool, getDatabasePoolState } from "../../../../../infrastructure/database";
import type { ActiveWhatsAppConnectionResolution } from "../../../../whatsapp-connection";
import {
  receiveWhatsAppCloudWebhook,
  setCloudWebhookProcessorForTesting,
  setWhatsAppActiveConnectionResolverForTesting,
  setWhatsAppInboundProducerProviderForTesting,
} from "../../whatsapp-cloud.controller";
import type { WhatsAppInboundJobInputData } from "../whatsapp-inbound-job.types";
import type { WhatsAppInboundProducerService } from "../whatsapp-inbound-producer.service";
import { env } from "../../../../../config/env";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type Resolution = ActiveWhatsAppConnectionResolution | null;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function activeResolution(sellerId: string, phoneNumberId: string): ActiveWhatsAppConnectionResolution {
  const now = new Date();
  return {
    sellerId,
    connection: {
      connectionId: `conn_${sellerId}`,
      sellerId,
      provider: "META_WHATSAPP_CLOUD_API",
      status: "ACTIVE",
      wabaId: `waba_${sellerId}`,
      phoneNumberId,
      connectedAt: now,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function buildWebhookBody(input: Readonly<{
  phoneNumberId?: string;
  customerPhone: string;
  messageId: string;
  text?: string;
  sellerId?: string;
}>): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    sellerId: input.sellerId,
    entry: [{
      changes: [{
        value: {
          metadata: input.phoneNumberId === undefined ? {} : { phone_number_id: input.phoneNumberId },
          contacts: [{ wa_id: input.customerPhone }],
          messages: [{
            id: input.messageId,
            from: input.customerPhone,
            type: "text",
            text: { body: input.text ?? "سلام" },
          }],
        },
      }],
    }],
  };
}

function buildStatusWebhookBody(phoneNumberId: string): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          statuses: [{ id: "wamid.status.phase11f", status: "delivered", recipient_id: "212600000099" }],
        },
      }],
    }],
  };
}

function createFakeRequest(body: unknown): Request {
  return {
    body,
    query: {},
    protocol: "http",
    header: () => undefined,
    get: (name: string) => (name.toLowerCase() === "host" ? "localhost:5000" : undefined),
  } as unknown as Request;
}

function createFakeResponse(): { response: Response; finished: Promise<{ statusCode: number; body: unknown }> } {
  let statusCode = 200;
  let resolved = false;
  let resolveFinished: (value: { statusCode: number; body: unknown }) => void = () => undefined;
  const finished = new Promise<{ statusCode: number; body: unknown }>((resolve) => {
    resolveFinished = resolve;
  });
  const response = {
    status: (code: number) => {
      statusCode = code;
      return response;
    },
    json: (body: unknown) => {
      if (!resolved) {
        resolved = true;
        resolveFinished({ statusCode, body });
      }
      return response;
    },
    send: (body: unknown) => {
      if (!resolved) {
        resolved = true;
        resolveFinished({ statusCode, body });
      }
      return response;
    },
    type: () => response,
  } as unknown as Response;
  return { response, finished };
}

async function invokeWebhook(body: unknown): Promise<{ statusCode: number; body: unknown }> {
  const { response, finished } = createFakeResponse();
  await receiveWhatsAppCloudWebhook(createFakeRequest(body), response);
  return finished;
}

class FakeProducer {
  jobs: WhatsAppInboundJobInputData[] = [];
  seen = new Set<string>();

  async enqueueInboundJob(data: WhatsAppInboundJobInputData): Promise<{ ok: true; duplicate: boolean; jobId: string }> {
    const jobId = `${data.sellerId}:${data.messageId}`;
    if (this.seen.has(jobId)) return { ok: true, duplicate: true, jobId };
    this.seen.add(jobId);
    this.jobs.push(data);
    return { ok: true, duplicate: false, jobId };
  }
}

async function withRoutingHarness<T>(
  resolutions: Readonly<Record<string, Resolution>>,
  callback: (producer: FakeProducer, resolverCalls: string[]) => Promise<T>,
): Promise<T> {
  const previousQueueEnabled = env.whatsappInboundQueueEnabled;
  const producer = new FakeProducer();
  const resolverCalls: string[] = [];
  try {
    env.whatsappInboundQueueEnabled = true;
    setWhatsAppInboundProducerProviderForTesting(() => producer as unknown as WhatsAppInboundProducerService);
    setCloudWebhookProcessorForTesting(async () => ({ ok: true, handled: false, actionsCount: 0, sendAttempted: false, sendSuccess: false, outboundMessages: [] }));
    setWhatsAppActiveConnectionResolverForTesting(async (phoneNumberId) => {
      resolverCalls.push(phoneNumberId);
      if (phoneNumberId === "999000999000999") throw new Error("database unavailable");
      return resolutions[phoneNumberId] ?? null;
    });
    return await callback(producer, resolverCalls);
  } finally {
    env.whatsappInboundQueueEnabled = previousQueueEnabled;
    setWhatsAppInboundProducerProviderForTesting(undefined);
    setCloudWebhookProcessorForTesting(undefined);
    setWhatsAppActiveConnectionResolverForTesting(undefined);
  }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11F imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const sellerAPhone = "111111111111111";
  const sellerBPhone = "222222222222222";
  const resolutions = {
    [sellerAPhone]: activeResolution("seller_phase11f_a", sellerAPhone),
    [sellerBPhone]: activeResolution("seller_phase11f_b", sellerBPhone),
  };

  await withRoutingHarness(resolutions, async (producer) => {
    const response = await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerAPhone, customerPhone: "212600000001", messageId: "msg_phase11f_a" }));
    const job = producer.jobs[0];
    add("ACTIVE phone_number_id resolves correct trusted seller", response.statusCode === 200 && job?.sellerId === "seller_phase11f_a" && job.phoneNumberId === sellerAPhone);
    add("Queue job contains trusted seller identity", job?.conversationKey === "seller_phase11f_a:212600000001");
  });

  await withRoutingHarness(resolutions, async (producer) => {
    await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerAPhone, customerPhone: "212600000007", messageId: "msg_phase11f_iso_a" }));
    await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerBPhone, customerPhone: "212600000007", messageId: "msg_phase11f_iso_b" }));
    add("Seller A and Seller B isolation is preserved", producer.jobs[0]?.sellerId === "seller_phase11f_a" && producer.jobs[1]?.sellerId === "seller_phase11f_b");
    add("Same customer phone creates distinct seller-scoped conversation keys", producer.jobs[0]?.conversationKey === "seller_phase11f_a:212600000007" && producer.jobs[1]?.conversationKey === "seller_phase11f_b:212600000007");
    add("No cross-seller queue job is possible", producer.jobs.every((job) => job.conversationKey.startsWith(`${job.sellerId}:`)));
  });

  await withRoutingHarness(resolutions, async (producer) => {
    await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerAPhone, customerPhone: "212600000008", messageId: "msg_phase11f_override", sellerId: "seller_attacker" }));
    add("Webhook-provided sellerId cannot override persisted seller", producer.jobs[0]?.sellerId === "seller_phase11f_a" && !JSON.stringify(producer.jobs[0]).includes("seller_attacker"));
  });

  await withRoutingHarness(resolutions, async (producer) => {
    const first = await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerAPhone, customerPhone: "212600000009", messageId: "msg_phase11f_duplicate" }));
    const second = await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerAPhone, customerPhone: "212600000009", messageId: "msg_phase11f_duplicate" }));
    add("Duplicate webhook still produces one effective inbound job", first.statusCode === 200 && second.statusCode === 200 && producer.jobs.length === 1);
  });

  await withRoutingHarness(resolutions, async (producer, resolverCalls) => {
    await invokeWebhook(buildWebhookBody({ phoneNumberId: "333333333333333", customerPhone: "212600000010", messageId: "msg_phase11f_unknown" }));
    add("Unknown phone_number_id does not enqueue", producer.jobs.length === 0 && resolverCalls.includes("333333333333333"));
  });

  for (const phoneNumberId of ["444444444444444", "555555555555555", "666666666666666", "777777777777777"]) {
    await withRoutingHarness(resolutions, async (producer) => {
      await invokeWebhook(buildWebhookBody({ phoneNumberId, customerPhone: "212600000011", messageId: `msg_phase11f_inactive_${phoneNumberId}` }));
      add("Inactive phone_number_id status does not enqueue", producer.jobs.length === 0);
    });
  }

  await withRoutingHarness(resolutions, async (producer, resolverCalls) => {
    await invokeWebhook(buildWebhookBody({ customerPhone: "212600000012", messageId: "msg_phase11f_missing" }));
    await invokeWebhook(buildWebhookBody({ phoneNumberId: "not-a-meta-id", customerPhone: "212600000013", messageId: "msg_phase11f_malformed" }));
    add("Missing or malformed phone_number_id does not enqueue", producer.jobs.length === 0 && !resolverCalls.includes("not-a-meta-id"));
  });

  await withRoutingHarness(resolutions, async (producer) => {
    const response = await invokeWebhook(buildStatusWebhookBody(sellerAPhone));
    add("Status events do not enter the Agent queue", response.statusCode === 200 && producer.jobs.length === 0);
  });

  await withRoutingHarness(resolutions, async (producer) => {
    const startedAt = Date.now();
    const response = await invokeWebhook(buildWebhookBody({ phoneNumberId: sellerAPhone, customerPhone: "212600000014", messageId: "msg_phase11f_fast" }));
    add("Webhook acknowledgment remains fast and non-blocking", response.statusCode === 200 && producer.jobs.length === 1 && Date.now() - startedAt < 250);
  });

  await withRoutingHarness(resolutions, async (producer) => {
    const response = await invokeWebhook(buildWebhookBody({ phoneNumberId: "999000999000999", customerPhone: "212600000015", messageId: "msg_phase11f_db_failure" }));
    add("Repository failure does not use fallback or enqueue untrusted job", response.statusCode === 503 && producer.jobs.length === 0);
  });

  add("Safe test output contains no tokens, WABA IDs, or raw payload dumps", !JSON.stringify(cases).includes("token") && !JSON.stringify(cases).includes("waba_") && !JSON.stringify(cases).includes("entry"));

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11F dynamic inbound routing test failed safely." })}\n`);
  process.exitCode = 1;
});
