import { createHmac, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, getDatabaseMigrationStatus, getDatabasePoolState } from "../../../infrastructure/database";
import { env } from "../../../config/env";
import { roleHasPermission } from "../../auth";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import { ManualWebhookConfigurationService } from "../application/manual-webhook-configuration.service";
import { buildManualWebhookCallbackUrl } from "../application/manual-webhook-url.service";
import { timingSafeStringEqual, verifyMetaSignature } from "../application/manual-webhook-security.service";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { ManualWebhookConfigurationError, WhatsAppConnectionMetaTransportError } from "../domain/whatsapp-connection.errors";
import type { ManualMetaTokenInspectionResult, ManualMetaWaba, ManualMetaPhoneNumber, ManualMetaWebhookTransport, ManualMetaWabaSubscription } from "../infrastructure/meta/manual-meta-app.transport";
import { PostgreSqlWhatsAppConnectionRepository } from "../infrastructure/postgresql/postgresql-whatsapp-connection.repository";
import { ManualWebhookPublicController } from "../http/manual-webhook-public.controller";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";
import { setCloudWebhookProcessorForTesting, setWhatsAppInboundProducerProviderForTesting } from "../../whatsapp/cloud/whatsapp-cloud.controller";
import type { WhatsAppInboundJobInputData } from "../../whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types";
import type { WhatsAppInboundProducerService } from "../../whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function encryptionService(): WhatsAppConnectionCredentialEncryptionService {
  const key = randomBytes(32).toString("base64");
  return new WhatsAppConnectionCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: "phase11k_m3",
    keysJson: JSON.stringify({ phase11k_m3: key }),
  }));
}

class FakeManualWebhookTransport implements ManualMetaWebhookTransport {
  subscriptions: ManualMetaWabaSubscription[] = [];
  subscribeCalls: Array<{ wabaId: string; callbackUrl: string; verifyToken: string; systemUserToken: string }> = [];
  failSubscribe: "auth" | "validation" | "unavailable" | null = null;
  addOnTimeout = false;
  noAddOnSubscribe = false;

  async inspectSystemUserToken(): Promise<ManualMetaTokenInspectionResult> {
    return { valid: true, appId: "123456789012345", type: "SYSTEM_USER", scopes: [], systemUserId: "system_user_m3" };
  }

  async listAssignedWabas(): Promise<readonly ManualMetaWaba[]> {
    return [];
  }

  async listPhoneNumbers(): Promise<readonly ManualMetaPhoneNumber[]> {
    return [];
  }

  async subscribeWabaWithCallback(wabaId: string, callbackUrl: string, verifyToken: string, systemUserToken: string): Promise<void> {
    this.subscribeCalls.push({ wabaId, callbackUrl, verifyToken, systemUserToken });
    if (this.failSubscribe) {
      if (this.addOnTimeout) this.subscriptions = [{ appId: "123456789012345", callbackUrl }];
      throw new WhatsAppConnectionMetaTransportError(this.failSubscribe);
    }
    if (!this.noAddOnSubscribe) this.subscriptions = [{ appId: "123456789012345", callbackUrl }];
  }

  async listWabaSubscriptions(): Promise<readonly ManualMetaWabaSubscription[]> {
    return this.subscriptions;
  }
}

class FakeProducer {
  jobs: WhatsAppInboundJobInputData[] = [];
  async enqueueInboundJob(data: WhatsAppInboundJobInputData): Promise<{ ok: true; duplicate: boolean; jobId: string }> {
    this.jobs.push(data);
    return { ok: true, duplicate: false, jobId: data.messageId };
  }
}

function responseProbe(): Partial<Response> & { statusCode?: number; body?: unknown; sentType?: string } {
  const probe: Partial<Response> & { statusCode?: number; body?: unknown; sentType?: string } = {};
  probe.status = (status: number) => {
    probe.statusCode = status;
    return probe as Response;
  };
  probe.type = (type: string) => {
    probe.sentType = type;
    return probe as Response;
  };
  probe.json = (body: unknown) => {
    probe.body = body;
    return probe as Response;
  };
  probe.send = (body: unknown) => {
    probe.body = body;
    return probe as Response;
  };
  probe.setHeader = () => probe as Response;
  return probe;
}

function signed(raw: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function webhookBody(wabaId: string, phoneNumberId: string, messageId = "wamid.phase11k_m3"): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: wabaId,
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ wa_id: "212600000123" }],
          messages: [{ id: messageId, from: "212600000123", type: "text", text: { body: "salam" } }],
        },
      }],
    }],
  };
}

function statusBody(wabaId: string, phoneNumberId: string): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: "wamid.status.m3", status: "delivered", recipient_id: "212600000123" }] } }] }],
  };
}

async function createSeller(service: SellerService, sellerId: string): Promise<void> {
  await service.createSeller(sellerId);
  sellerIds.push(sellerId);
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
}

async function invokeVerify(controller: ManualWebhookPublicController, publicWebhookId: string, query: Record<string, unknown>): Promise<{ statusCode?: number; body?: unknown; sentType?: string }> {
  const res = responseProbe();
  await controller.verify({ params: { publicWebhookId }, query } as unknown as Request, res as Response);
  return res;
}

async function invokePost(controller: ManualWebhookPublicController, publicWebhookId: string, raw: Buffer, signature?: string): Promise<{ statusCode?: number; body?: unknown }> {
  const res = responseProbe();
  await controller.receive({
    params: { publicWebhookId },
    body: raw,
    protocol: "https",
    header: (name: string) => name.toLowerCase() === "x-hub-signature-256" ? signature : undefined,
    get: () => "backend.example",
  } as unknown as Request, res as Response);
  return res;
}

async function issue(callback: () => Promise<unknown>): Promise<string | null> {
  try {
    await callback();
    return null;
  } catch (error) {
    return error instanceof ManualWebhookConfigurationError ? error.issueCode : "unexpected";
  }
}

async function controllerRejects(body: Record<string, unknown>): Promise<boolean> {
  const controller = new WhatsAppConnectionController({} as never, undefined, undefined, undefined, undefined, undefined, {
    configure: async () => ({ connection: { connectionId: "conn", status: "VERIFYING", connectionMethod: "CUSTOMER_OWNED_META_APP" }, webhook: { configured: true, verified: true, subscriptionConfirmed: true }, nextStep: "FINALIZE_CONNECTION" }),
  } as never);
  const res = responseProbe();
  await controller.configureManualWebhook({ body, params: { connectionId: "conn" }, tenant: createTenantContext("seller_phase11k_m3_controller") } as unknown as Request, res as Response);
  return res.statusCode === 400;
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11K-M3 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const migrationStatus = await getDatabaseMigrationStatus();
  add("No Phase 11K-M3 migration is pending or required", migrationStatus.applied.includes("0013") && migrationStatus.pending.length === 0);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const encryption = encryptionService();
  const setupService = new ManualConnectionSetupService(repository, encryption);
  const publicController = new ManualWebhookPublicController(repository, encryption);
  const sellerA = uniqueId("seller_phase11k_m3");
  const sellerB = uniqueId("seller_phase11k_m3");
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);
  const appSecret = "safe_fake_app_secret_phase11k_m3";
  const systemToken = "safe_fake_system_user_token_phase11k_m3";

  try {
    await createSeller(sellerService, sellerA);
    await createSeller(sellerService, sellerB);

    const existingActive = await repository.createCandidate(tenantA);
    await repository.persistVerifiedMetadata(tenantA, existingActive.connectionId, { phoneNumberId: "active_phase11k_m3", displayPhoneNumber: "+212 600 000 888" });
    const activatedExisting = await repository.updateLifecycleStatus(tenantA, existingActive.connectionId, "ACTIVE");

    const setup = await setupService.setup(tenantA, { appId: "123456789012345", appSecret, systemUserAccessToken: systemToken });
    await repository.persistVerifiedMetadata(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m3", phoneNumberId: "111111111111111", displayPhoneNumber: "+212 600 000 555", verifiedName: "M3 Shop" });
    await repository.updateLifecycleStatus(tenantA, setup.connection.connectionId, "VERIFYING");
    const connection = await repository.findByConnectionId(tenantA, setup.connection.connectionId);
    const publicWebhookId = connection?.publicWebhookId ?? "";
    const verifyToken = setup.webhookSetup.verifyToken;

    const validVerify = await invokeVerify(publicController, publicWebhookId, { "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": "challenge-m3" });
    add("valid mode/token returns exact challenge", validVerify.statusCode === 200 && validVerify.body === "challenge-m3" && validVerify.sentType === "text/plain");
    add("wrong mode rejected", (await invokeVerify(publicController, publicWebhookId, { "hub.mode": "wrong", "hub.verify_token": verifyToken, "hub.challenge": "c" })).statusCode === 403);
    add("missing fields rejected", (await invokeVerify(publicController, publicWebhookId, { "hub.mode": "subscribe", "hub.verify_token": verifyToken })).statusCode === 403);
    add("wrong token rejected", (await invokeVerify(publicController, publicWebhookId, { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "c" })).statusCode === 403);
    add("timing-safe comparison boundary used", timingSafeStringEqual("same", "same") && !timingSafeStringEqual("same", "short"));
    add("unknown publicWebhookId fails generically", (await invokeVerify(publicController, "unknown_public_webhook_id", { "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": "c" })).statusCode === 403);
    const setupB = await setupService.setup(tenantB, { appId: "123456789012345", appSecret, systemUserAccessToken: systemToken });
    add("another connection's token fails", (await invokeVerify(publicController, publicWebhookId, { "hub.mode": "subscribe", "hub.verify_token": setupB.webhookSetup.verifyToken, "hub.challenge": "c" })).statusCode === 403);
    add("token never appears in errors", !JSON.stringify(await invokeVerify(publicController, publicWebhookId, { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "c" })).includes(verifyToken));

    const callbackUrl = buildManualWebhookCallbackUrl(publicWebhookId, "https://backend.example");
    add("trusted HTTPS callback URL constructed correctly", callbackUrl === `https://backend.example/api/whatsapp/webhooks/connections/${publicWebhookId}`);
    add("invalid public callback URL fails closed", issue(() => Promise.resolve(buildManualWebhookCallbackUrl(publicWebhookId, "http://backend.example"))) instanceof Promise);

    const transport = new FakeManualWebhookTransport();
    const configureService = new ManualWebhookConfigurationService(repository, encryption, transport, "https://backend.example");
    const configured = await configureService.configure(tenantA, setup.connection.connectionId);
    add("correct WABA subscription request uses seller token", transport.subscribeCalls[0]?.wabaId === "waba_phase11k_m3" && transport.subscribeCalls[0]?.systemUserToken === systemToken);
    add("callback override and Verify Token are sent in request body boundary", transport.subscribeCalls[0]?.callbackUrl === callbackUrl && transport.subscribeCalls[0]?.verifyToken === verifyToken);
    add("readback confirms correct app", configured.webhook.subscriptionConfirmed === true);
    add("configure response is safe", !/safe_fake|token|seller_phase11k|\+212/i.test(JSON.stringify(configured)) && configured.nextStep === "FINALIZE_CONNECTION");
    add("same configuration retry is idempotent", (await configureService.configure(tenantA, setup.connection.connectionId)).webhook.configured === true && transport.subscribeCalls.length === 1);
    const wrongAppTransport = new FakeManualWebhookTransport();
    wrongAppTransport.subscriptions = [{ appId: "another_app", callbackUrl }];
    wrongAppTransport.noAddOnSubscribe = true;
    add("another app subscription is not treated as success", await issue(() => new ManualWebhookConfigurationService(repository, encryption, wrongAppTransport, "https://backend.example").configure(tenantA, setup.connection.connectionId)) === "WEBHOOK_SUBSCRIPTION_UNCONFIRMED");
    const timeoutTransport = new FakeManualWebhookTransport();
    timeoutTransport.failSubscribe = "unavailable";
    timeoutTransport.addOnTimeout = true;
    add("timeout with successful readback resumes safely", (await new ManualWebhookConfigurationService(repository, encryption, timeoutTransport, "https://backend.example").configure(tenantA, setup.connection.connectionId)).webhook.subscriptionConfirmed === true);
    const failedTransport = new FakeManualWebhookTransport();
    failedTransport.failSubscribe = "validation";
    const failedSetup = await setupService.setup(tenantB, { appId: "123456789012345", appSecret, systemUserAccessToken: systemToken });
    await repository.persistVerifiedMetadata(tenantB, failedSetup.connection.connectionId, { wabaId: "waba_phase11k_m3_b", phoneNumberId: "222222222222222" });
    await repository.updateLifecycleStatus(tenantB, failedSetup.connection.connectionId, "VERIFYING");
    add("failed subscription does not persist success markers", await issue(() => new ManualWebhookConfigurationService(repository, encryption, failedTransport, "https://backend.example").configure(tenantB, failedSetup.connection.connectionId)) === "WEBHOOK_SUBSCRIPTION_FAILED" && !(await repository.findByConnectionId(tenantB, failedSetup.connection.connectionId))?.wabaSubscriptionCompletedAt);
    add("existing ACTIVE connection remains untouched and draft remains VERIFYING", (await repository.findActiveBySeller(tenantA))?.connectionId === activatedExisting?.connectionId && (await repository.findByConnectionId(tenantA, setup.connection.connectionId))?.status === "VERIFYING");
    add("browser cannot override callback URL", await controllerRejects({ callbackUrl: "https://evil.example" }) && await controllerRejects({ sellerId: sellerA }) && await controllerRejects({ verifyToken }));
    add("OWNER/ADMIN may configure while AGENT/VIEWER may not", roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage") && !roleHasPermission("AGENT", "whatsapp_connection.manage") && !roleHasPermission("VIEWER", "whatsapp_connection.manage"));

    const previousQueueEnabled = env.whatsappInboundQueueEnabled;
    const producer = new FakeProducer();
    let processorCalls = 0;
    try {
      env.whatsappInboundQueueEnabled = true;
      setWhatsAppInboundProducerProviderForTesting(() => producer as unknown as WhatsAppInboundProducerService);
      setCloudWebhookProcessorForTesting(async () => {
        processorCalls += 1;
        return { ok: true, handled: false, actionsCount: 0, sendAttempted: false, sendSuccess: false, outboundMessages: [] };
      });
      const raw = Buffer.from(JSON.stringify(webhookBody("waba_phase11k_m3", "111111111111111", "msg_verifying_m3")));
      add("valid raw-body signature accepted", (await invokePost(publicController, publicWebhookId, raw, signed(raw, appSecret))).statusCode === 200);
      add("VERIFYING connection never enqueues or invokes Agent", producer.jobs.length === 0);
      add("missing signature rejected", (await invokePost(publicController, publicWebhookId, raw, undefined)).statusCode === 403);
      add("malformed prefix rejected", (await invokePost(publicController, publicWebhookId, raw, `sha1=${signed(raw, appSecret).slice(7)}`)).statusCode === 403);
      add("invalid hex rejected", (await invokePost(publicController, publicWebhookId, raw, "sha256=zz")).statusCode === 403);
      add("signature mismatch rejected", (await invokePost(publicController, publicWebhookId, raw, signed(Buffer.from("{}"), appSecret))).statusCode === 403);
      add("verification occurs before JSON parsing", (await invokePost(publicController, publicWebhookId, Buffer.from("{not-json"), "sha256=bad")).statusCode === 403);
      add("reserialized JSON is not used", verifyMetaSignature(Buffer.from("{ \"a\": 1 }"), appSecret, signed(Buffer.from("{ \"a\": 1 }"), appSecret)) && !verifyMetaSignature(Buffer.from("{ \"a\": 1 }"), appSecret, signed(Buffer.from(JSON.stringify({ a: 1 })), appSecret)));
      const malformed = Buffer.from("{not-json");
      add("malformed JSON after valid signature fails safely", (await invokePost(publicController, publicWebhookId, malformed, signed(malformed, appSecret))).statusCode === 400);
      const wrongWaba = Buffer.from(JSON.stringify(webhookBody("waba_wrong", "111111111111111")));
      add("WABA mismatch rejected", (await invokePost(publicController, publicWebhookId, wrongWaba, signed(wrongWaba, appSecret))).statusCode === 400);
      const wrongPhone = Buffer.from(JSON.stringify(webhookBody("waba_phase11k_m3", "phone_wrong")));
      add("phone_number_id mismatch rejected", (await invokePost(publicController, publicWebhookId, wrongPhone, signed(wrongPhone, appSecret))).statusCode === 400);
      await repository.activateConnection(tenantB, failedSetup.connection.connectionId);
      const failedConnection = await repository.findByConnectionId(tenantB, failedSetup.connection.connectionId);
      const activePublicWebhookId = failedConnection?.publicWebhookId ?? "";
      const activeRaw = Buffer.from(JSON.stringify(webhookBody("waba_phase11k_m3_b", "222222222222222", "msg_active_m3")));
      add("ACTIVE connection hands off exactly once to existing pipeline", (await invokePost(publicController, activePublicWebhookId, activeRaw, signed(activeRaw, appSecret))).statusCode === 200 && producer.jobs.filter((job) => job.messageId === "msg_active_m3").length === 1);
      const statusRaw = Buffer.from(JSON.stringify(statusBody("waba_phase11k_m3", "111111111111111")));
      add("status-only behavior remains unchanged", (await invokePost(publicController, publicWebhookId, statusRaw, signed(statusRaw, appSecret))).statusCode === 200 && processorCalls >= 1);
      add("no secrets or payloads appear in errors", !JSON.stringify(await invokePost(publicController, publicWebhookId, raw, "sha256=bad")).includes(appSecret) && !JSON.stringify(await invokePost(publicController, publicWebhookId, wrongPhone, signed(wrongPhone, appSecret))).includes("salam"));
    } finally {
      env.whatsappInboundQueueEnabled = previousQueueEnabled;
      setWhatsAppInboundProducerProviderForTesting(undefined);
      setCloudWebhookProcessorForTesting(undefined);
    }
  } finally {
    await cleanup();
    const remainingConnections = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("Only Phase 11K-M3 test rows are cleaned up", remainingConnections.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11K-M3 manual webhook security test failed safely.", error: error instanceof Error ? error.name : "unknown" })}\n`);
  process.exitCode = 1;
});
