import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDatabasePool, getDatabasePoolState, type TenantContext } from "../../../../../infrastructure/database";
import type { WhatsAppConnectionRepository } from "../../../../whatsapp-connection";
import {
  PersistentWhatsAppOutboundConnectionResolver,
  type WhatsAppOutboundConnectionResolver,
} from "../../outbound-connection/whatsapp-outbound-connection-resolver";
import { WhatsAppConnectionCredentialEncryptionError, type WhatsAppConnectionCredentialService } from "../../../../whatsapp-connection";
import { dispatchPreparedOutboundGroupDirectly } from "../../whatsapp-cloud.service";
import { WhatsAppOutboundError } from "../whatsapp-outbound.errors";
import { classifyOutboundFailure } from "../whatsapp-outbound-reliability";
import { validateWhatsAppOutboundResponseGroup } from "../whatsapp-outbound-validation";
import {
  WHATSAPP_OUTBOUND_SCHEMA_VERSION,
  type WhatsAppOutboundResponseGroup,
} from "../whatsapp-outbound-job.types";
import { env } from "../../../../../config/env";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean; detail?: string }>;
type FetchCall = Readonly<{ url: string; authorization: string; body: string }>;

const cases: TestCase[] = [];
const fetchCalls: FetchCall[] = [];

function add(name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, ...(detail ? { detail } : {}) });
}

function group(input: Readonly<{
  sellerId: string;
  sourceId?: string;
  to?: string;
  text?: string;
  commandExtras?: Record<string, unknown>;
}>): WhatsAppOutboundResponseGroup {
  const sourceId = input.sourceId || `source_${input.sellerId}`;
  const to = input.to || "212600000001";
  return {
    schemaVersion: WHATSAPP_OUTBOUND_SCHEMA_VERSION,
    sellerId: input.sellerId,
    conversationKey: `${input.sellerId}:${to}`,
    recipient: { waId: to },
    source: { type: "inbound_message", id: sourceId },
    responseGroupId: `inbound_message.${sourceId}.agent_reply.main`,
    responseGroupRole: "agent_reply.main",
    createdAt: "2026-07-28T00:00:00.000Z",
    commands: [{
      type: "agent_reply",
      to,
      replyText: input.text || "hello",
      ...(input.commandExtras || {}),
    }],
  };
}

function resolver(connections: Record<string, { phoneNumberId: string; accessToken: string }>): WhatsAppOutboundConnectionResolver {
  return Object.freeze({
    resolveForTrustedSeller: async (sellerId: string) => {
      const connection = connections[sellerId];
      if (!connection) throw new WhatsAppOutboundError("missing_active_connection");
      return {
        sellerId,
        connectionId: `conn_${sellerId}`,
        phoneNumberId: connection.phoneNumberId,
        accessToken: connection.accessToken,
      };
    },
  });
}

function fakeRepository(rows: Record<string, { status: string; phoneNumberId?: string }>): WhatsAppConnectionRepository {
  return {
    findActiveBySeller: async (tenant: TenantContext) => {
      const row = rows[tenant.sellerId];
      if (!row || row.status !== "ACTIVE") return null;
      return {
        connectionId: `conn_${tenant.sellerId}`,
        sellerId: tenant.sellerId,
        provider: "META_WHATSAPP_CLOUD_API",
        status: "ACTIVE",
        phoneNumberId: row.phoneNumberId,
        createdAt: new Date("2026-07-28T00:00:00.000Z"),
        updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      };
    },
  } as unknown as WhatsAppConnectionRepository;
}

function fakeCredentialService(input: Readonly<{
  token?: string | null;
  throwDecrypt?: boolean;
}>): WhatsAppConnectionCredentialService {
  return {
    decryptStoredAccessToken: async () => {
      if (input.throwDecrypt) throw new WhatsAppConnectionCredentialEncryptionError();
      return input.token ?? null;
    },
  } as unknown as WhatsAppConnectionCredentialService;
}

async function expectsOutboundError(
  callback: () => Promise<unknown> | unknown,
  category: string,
): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof WhatsAppOutboundError && error.category === category;
  }
}

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function withFakeFetch<T>(callback: () => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  const previousDryRun = env.whatsappCloudDryRun;
  const previousToken = env.whatsappCloudAccessToken;
  const previousPhone = env.whatsappCloudPhoneNumberId;
  try {
    fetchCalls.length = 0;
    (env as Record<string, unknown>).whatsappCloudDryRun = false;
    (env as Record<string, unknown>).whatsappCloudAccessToken = "global_token_must_not_be_used";
    (env as Record<string, unknown>).whatsappCloudPhoneNumberId = "999999999999999";
    globalThis.fetch = (async (url, init) => {
      fetchCalls.push({
        url: String(url),
        authorization: String((init?.headers as Record<string, unknown> | undefined)?.Authorization || ""),
        body: String(init?.body || ""),
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.phase11g" }] }),
      } as Response;
    }) as typeof fetch;
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
    (env as Record<string, unknown>).whatsappCloudDryRun = previousDryRun;
    (env as Record<string, unknown>).whatsappCloudAccessToken = previousToken;
    (env as Record<string, unknown>).whatsappCloudPhoneNumberId = previousPhone;
  }
}

async function run(): Promise<void> {
  await closeDatabasePool();
  add("no DB activity on import", getDatabasePoolState().initialized === false);

  const isolatedResolver = resolver({
    seller_a: { phoneNumberId: "111111111111111", accessToken: "token_a" },
    seller_b: { phoneNumberId: "222222222222222", accessToken: "token_b" },
  });
  await withFakeFetch(async () => {
    await dispatchPreparedOutboundGroupDirectly(group({ sellerId: "seller_a" }), {
      outboundConnectionResolver: isolatedResolver,
    });
    await dispatchPreparedOutboundGroupDirectly(group({ sellerId: "seller_b" }), {
      outboundConnectionResolver: isolatedResolver,
    });
    await dispatchPreparedOutboundGroupDirectly(group({ sellerId: "seller_a", to: "212600000777", sourceId: "same_a" }), {
      outboundConnectionResolver: isolatedResolver,
    });
    await dispatchPreparedOutboundGroupDirectly(group({ sellerId: "seller_b", to: "212600000777", sourceId: "same_b" }), {
      outboundConnectionResolver: isolatedResolver,
    });
  });
  add("Seller A sends with Phone A and Token A", fetchCalls[0]?.url.includes("/111111111111111/messages") && fetchCalls[0]?.authorization === "Bearer token_a");
  add("Seller B sends with Phone B and Token B", fetchCalls[1]?.url.includes("/222222222222222/messages") && fetchCalls[1]?.authorization === "Bearer token_b");
  add("same recipient under two sellers remains isolated", fetchCalls[2]?.url.includes("/111111111111111/messages") && fetchCalls[3]?.url.includes("/222222222222222/messages"));
  add("no global/test credential fallback occurs during resolved runtime sends", fetchCalls.every((call) => !call.url.includes("/999999999999999/") && call.authorization !== "Bearer global_token_must_not_be_used"));

  add("untrusted phone_number_id cannot override persistence", await expectsOutboundError(() => validateWhatsAppOutboundResponseGroup(group({ sellerId: "seller_a", commandExtras: { phoneNumberId: "333333333333333" } })), "invalid_outbound_group"));
  add("untrusted token cannot override persistence", await expectsOutboundError(() => validateWhatsAppOutboundResponseGroup(group({ sellerId: "seller_a", commandExtras: { accessToken: "attacker" } })), "invalid_outbound_group"));
  add("queue payload contains no credentials or phone routing", !/token|credential|secret|phoneNumberId|phone_number_id|sender/i.test(JSON.stringify(group({ sellerId: "seller_a" }))));

  const activeResolver = new PersistentWhatsAppOutboundConnectionResolver(
    fakeRepository({ seller_active: { status: "ACTIVE", phoneNumberId: "333333333333333" } }),
    fakeCredentialService({ token: "token_active" }),
  );
  const active = await activeResolver.resolveForTrustedSeller("seller_active");
  add("ACTIVE connection resolves only by trusted seller", active.phoneNumberId === "333333333333333" && active.accessToken === "token_active");
  add("no ACTIVE connection fails closed", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({}), fakeCredentialService({ token: "x" })).resolveForTrustedSeller("seller_missing"), "missing_active_connection"));
  add("VERIFYING connection is not used", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({ seller_verifying: { status: "VERIFYING", phoneNumberId: "444444444444444" } }), fakeCredentialService({ token: "x" })).resolveForTrustedSeller("seller_verifying"), "missing_active_connection"));
  add("DISCONNECTED connection is not used", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({ seller_disconnected: { status: "DISCONNECTED", phoneNumberId: "555555555555555" } }), fakeCredentialService({ token: "x" })).resolveForTrustedSeller("seller_disconnected"), "missing_active_connection"));
  add("REVOKED connection is not used", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({ seller_revoked: { status: "REVOKED", phoneNumberId: "666666666666666" } }), fakeCredentialService({ token: "x" })).resolveForTrustedSeller("seller_revoked"), "missing_active_connection"));
  add("missing credentials fail closed", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({ seller_no_creds: { status: "ACTIVE", phoneNumberId: "777777777777777" } }), fakeCredentialService({ token: null })).resolveForTrustedSeller("seller_no_creds"), "missing_connection_credentials"));
  add("undecryptable credentials fail closed", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({ seller_bad_creds: { status: "ACTIVE", phoneNumberId: "888888888888888" } }), fakeCredentialService({ throwDecrypt: true })).resolveForTrustedSeller("seller_bad_creds"), "credential_decryption_failed"));
  add("malformed persisted phone_number_id fails closed", await expectsOutboundError(() => new PersistentWhatsAppOutboundConnectionResolver(fakeRepository({ seller_bad_phone: { status: "ACTIVE", phoneNumberId: "not-a-phone" } }), fakeCredentialService({ token: "x" })).resolveForTrustedSeller("seller_bad_phone"), "malformed_persisted_phone_number_id"));

  const mutable = { seller_a: { phoneNumberId: "123451234512345", accessToken: "first_token" } };
  const retryResolver = resolver(mutable);
  await withFakeFetch(async () => {
    await dispatchPreparedOutboundGroupDirectly(group({ sellerId: "seller_a", sourceId: "retry_1" }), { outboundConnectionResolver: retryResolver });
    mutable.seller_a = { phoneNumberId: "543215432154321", accessToken: "second_token" };
    await dispatchPreparedOutboundGroupDirectly(group({ sellerId: "seller_a", sourceId: "retry_2" }), { outboundConnectionResolver: retryResolver });
  });
  add("retry resolves only the trusted seller current ACTIVE connection", fetchCalls[0]?.authorization === "Bearer first_token" && fetchCalls[1]?.authorization === "Bearer second_token" && fetchCalls[1]?.url.includes("/543215432154321/messages"));

  add("permanent connection configuration errors follow non-retry policy", classifyOutboundFailure(new WhatsAppOutboundError("missing_active_connection")).classification === "permanent");
  add("transient Meta failure preserves retry behavior", classifyOutboundFailure(new WhatsAppOutboundError("outbound_transport_failed")).classification === "retryable");
  add("Meta 4xx permanent failures are non-retryable", classifyOutboundFailure(new WhatsAppOutboundError("outbound_transport_permanent_failed")).classification === "permanent");

  const workerSource = await source("src/modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-worker.service.ts");
  const compositionSource = await source("src/composition/queue/whatsapp-inbound-queue.composition.ts");
  const cloudSource = await source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts");
  const outboxSource = await source("src/modules/whatsapp/cloud/transactional-outbox/publisher/whatsapp-transactional-outbox-publisher.ts");
  add("queue worker requires dynamic outbound connection resolver", /outboundConnectionResolver: WhatsAppOutboundConnectionResolver/.test(workerSource) && /PersistentWhatsAppOutboundConnectionResolver/.test(compositionSource));
  add("outbox dispatch uses seller connection through the outbound worker", /dispatchOutboundGroup\(row\.payload\)/.test(outboxSource) && /outboundConnectionResolver/.test(workerSource));
  add("confirmed-order receipt uses resolved seller connection", /sendOrderReceiptDocumentForOrder\([\s\S]*phoneNumberId: connection\?\.phoneNumberId[\s\S]*accessToken: connection\?\.accessToken/.test(cloudSource));
}

async function main(): Promise<void> {
  try {
    await run();
  } finally {
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  for (const [index, test] of cases.entries()) {
    console.log(`${test.passed ? "PASS" : "FAIL"} ${index + 1}. ${test.name}${test.detail ? ` (${test.detail})` : ""}`);
  }
  console.log(`Phase 11G dynamic outbound connection tests: ${cases.length - failed.length}/${cases.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  await closeDatabasePool();
  console.error(JSON.stringify({
    ok: false,
    message: "Phase 11G dynamic outbound connection test failed safely.",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  }));
  process.exitCode = 1;
});
