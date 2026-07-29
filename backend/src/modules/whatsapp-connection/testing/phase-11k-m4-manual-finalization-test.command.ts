import { createHmac, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, getDatabaseMigrationStatus, getDatabasePoolState, type TenantContext } from "../../../infrastructure/database";
import { env } from "../../../config/env";
import { roleHasPermission } from "../../auth";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ManualConnectionFinalizationService } from "../application/manual-connection-finalization.service";
import { MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES, MANUAL_SYSTEM_USER_SCOPE_CONTRACT } from "../application/manual-system-user-token-validation";
import { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialService } from "../application/whatsapp-connection-credential.service";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import { ManualFinalizationError, WhatsAppConnectionMetaTransportError } from "../domain/whatsapp-connection.errors";
import { FetchManualMetaAppTransport, type ManualMetaPhoneNumber, type ManualMetaPhoneRegistrationStatus, type ManualMetaTokenInspectionResult, type ManualMetaWaba, type ManualMetaWabaSubscription, type ManualMetaWebhookTransport } from "../infrastructure/meta/manual-meta-app.transport";
import { PostgreSqlWhatsAppConnectionRepository } from "../infrastructure/postgresql/postgresql-whatsapp-connection.repository";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";
import { ManualWebhookPublicController } from "../http/manual-webhook-public.controller";
import { PersistentWhatsAppOutboundConnectionResolver } from "../../whatsapp/cloud/outbound-connection/whatsapp-outbound-connection-resolver";
import { setCloudWebhookProcessorForTesting, setWhatsAppInboundProducerProviderForTesting } from "../../whatsapp/cloud/whatsapp-cloud.controller";
import type { ProcessCloudWebhookOptions } from "../../whatsapp/cloud/whatsapp-cloud.service";
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

class CountingCredentialEncryptionService extends WhatsAppConnectionCredentialEncryptionService {
  systemUserAccessTokenDecryptions = 0;

  override decryptManualSystemUserAccessToken(encryptedSystemUserAccessToken: string): string {
    this.systemUserAccessTokenDecryptions += 1;
    return super.decryptManualSystemUserAccessToken(encryptedSystemUserAccessToken);
  }
}

function encryptionService(): CountingCredentialEncryptionService {
  const key = randomBytes(32).toString("base64");
  return new CountingCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: "phase11k_m4",
    keysJson: JSON.stringify({ phase11k_m4: key }),
  }));
}

class FakeManualFinalizationTransport implements ManualMetaWebhookTransport {
  inspection: ManualMetaTokenInspectionResult = {
    valid: true,
    appId: "123456789012345",
    type: "SYSTEM_USER",
    scopes: MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES,
    expiresAt: new Date(Date.now() + 86_400_000),
    systemUserId: "system_user_m4",
  };
  wabas: ManualMetaWaba[] = [{ id: "123456789000001", name: "M4 WABA" }];
  phones = new Map<string, ManualMetaPhoneNumber[]>([["123456789000001", [{ id: "123456789000002", wabaId: "123456789000001", displayPhoneNumber: "+212 600 000 222", verifiedName: "M4 Shop" }]]]);
  subscriptions: ManualMetaWabaSubscription[] = [{ appId: "123456789012345", callbackUrl: "https://backend.example/api/whatsapp/webhooks/connections/" }];
  registration: ManualMetaPhoneRegistrationStatus = { id: "123456789000002", registered: true };
  registerCalls: Array<{ phoneNumberId: string; pin: string; token: string }> = [];
  setTwoStepPinCalls: Array<{ phoneNumberId: string; pin: string; token: string }> = [];
  directWabaReads: Array<{ wabaId: string; token: string }> = [];
  directPhoneReads: Array<{ phoneNumberId: string; token: string }> = [];
  assignedWabaListCalls = 0;
  registerError: "validation" | "unavailable" | null = null;
  registerMetaErrorCode: number | null = null;
  registerMakesReady = true;
  twoStepPinUpdated = false;

  async inspectSystemUserToken(): Promise<ManualMetaTokenInspectionResult> {
    return this.inspection;
  }

  async listAssignedWabas(): Promise<readonly ManualMetaWaba[]> {
    this.assignedWabaListCalls += 1;
    return this.wabas;
  }

  async readWaba(wabaId: string, token: string): Promise<ManualMetaWaba> {
    this.directWabaReads.push({ wabaId, token });
    const waba = this.wabas.find((candidate) => candidate.id === wabaId);
    if (!waba) throw new WhatsAppConnectionMetaTransportError("not_found");
    return waba;
  }

  async listPhoneNumbers(wabaId: string): Promise<readonly ManualMetaPhoneNumber[]> {
    return this.phones.get(wabaId) ?? [];
  }

  async readPhoneNumber(phoneNumberId: string, token: string): Promise<ManualMetaPhoneNumber> {
    this.directPhoneReads.push({ phoneNumberId, token });
    const phone = [...this.phones.values()]
      .flat()
      .find((candidate) => candidate.id === phoneNumberId);
    if (!phone) throw new WhatsAppConnectionMetaTransportError("not_found");
    return phone;
  }

  async subscribeWabaWithCallback(): Promise<void> {
    return undefined;
  }

  async listWabaSubscriptions(): Promise<readonly ManualMetaWabaSubscription[]> {
    return this.subscriptions;
  }

  async registerPhoneNumber(phoneNumberId: string, pin: string, token: string): Promise<void> {
    this.registerCalls.push({ phoneNumberId, pin, token });
    if (this.registerError) {
      if (this.registerMetaErrorCode === 133005 && this.twoStepPinUpdated) {
        this.registerError = null;
        this.registration = { id: phoneNumberId, registered: true };
        return;
      }
      if (this.registerError === "unavailable" && this.registerMakesReady) this.registration = { id: phoneNumberId, registered: true };
      throw new WhatsAppConnectionMetaTransportError(this.registerError, {
        operation: "register_phone_number",
        httpStatus: 400,
        metaErrorCode: this.registerMetaErrorCode,
      });
    }
    this.registration = { id: phoneNumberId, registered: true };
  }

  async setPhoneTwoStepVerificationPin(phoneNumberId: string, pin: string, token: string): Promise<void> {
    this.setTwoStepPinCalls.push({ phoneNumberId, pin, token });
    this.twoStepPinUpdated = true;
  }

  async readPhoneRegistrationStatus(phoneNumberId: string): Promise<ManualMetaPhoneRegistrationStatus> {
    return this.registration.id === phoneNumberId ? this.registration : { id: phoneNumberId, registered: false };
  }
}

function failureReadyTransport(publicWebhookId: string, phoneNumberId: string): FakeManualFinalizationTransport {
  const transport = new FakeManualFinalizationTransport();
  transport.phones = new Map([["123456789000001", [{ id: phoneNumberId, wabaId: "123456789000001" }]]]);
  transport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${publicWebhookId}` }];
  transport.registration = { id: phoneNumberId, registered: true };
  return transport;
}

class FakeProducer {
  jobs: WhatsAppInboundJobInputData[] = [];
  async enqueueInboundJob(data: WhatsAppInboundJobInputData): Promise<{ ok: true; duplicate: boolean; jobId: string }> {
    this.jobs.push(data);
    return { ok: true, duplicate: false, jobId: data.messageId };
  }
}

function responseProbe(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const probe: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  probe.status = (status: number) => {
    probe.statusCode = status;
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
  probe.type = () => probe as Response;
  probe.setHeader = () => probe as Response;
  return probe;
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

async function issue(callback: () => Promise<unknown>): Promise<string | null> {
  try {
    await callback();
    return null;
  } catch (error) {
    return error instanceof ManualFinalizationError ? error.issueCode : "unexpected";
  }
}

function signed(raw: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function webhookBody(wabaId: string, phoneNumberId: string, messageId = "wamid.phase11k_m4"): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: "212600000333" }], messages: [{ id: messageId, from: "212600000333", type: "text", text: { body: "salam" } }] } }] }],
  };
}

async function invokePost(controller: ManualWebhookPublicController, publicWebhookId: string, raw: Buffer, appSecret: string): Promise<{ statusCode?: number; body?: unknown }> {
  const res = responseProbe();
  await controller.receive({
    params: { publicWebhookId },
    body: raw,
    protocol: "https",
    header: (name: string) => name.toLowerCase() === "x-hub-signature-256" ? signed(raw, appSecret) : undefined,
    get: () => "backend.example",
  } as unknown as Request, res as Response);
  return res;
}

async function controllerRejects(body: Record<string, unknown>): Promise<boolean> {
  const controller = new WhatsAppConnectionController({} as never, undefined, undefined, undefined, undefined, undefined, undefined, {
    finalize: async () => ({ connection: { connectionId: "conn", status: "ACTIVE", connectionMethod: "CUSTOMER_OWNED_META_APP", maskedPhoneNumber: null, verifiedName: null, connectedAt: new Date().toISOString() }, health: { status: "HEALTHY" } }),
  } as never);
  const res = responseProbe();
  await controller.finalizeManualConnection({ body, params: { connectionId: "conn" }, tenant: createTenantContext("seller_phase11k_m4_controller") } as unknown as Request, res as Response);
  return res.statusCode === 400;
}

async function makeReadyManual(input: {
  repository: PostgreSqlWhatsAppConnectionRepository;
  setupService: ManualConnectionSetupService;
  tenant: TenantContext;
  appSecret: string;
  systemToken: string;
  phoneNumberId?: string;
  markWebhook?: boolean;
}): Promise<{ connectionId: string; publicWebhookId: string }> {
  const setup = await input.setupService.setup(input.tenant, { appId: "123456789012345", appSecret: input.appSecret, systemUserAccessToken: input.systemToken });
  await input.repository.persistVerifiedMetadata(input.tenant, setup.connection.connectionId, {
    wabaId: "123456789000001",
    phoneNumberId: input.phoneNumberId ?? "123456789000002",
    displayPhoneNumber: "+212 600 000 222",
    verifiedName: "M4 Shop",
  });
  await input.repository.updateLifecycleStatus(input.tenant, setup.connection.connectionId, "VERIFYING");
  if (input.markWebhook !== false) {
    await input.repository.persistFinalizationProgress(input.tenant, setup.connection.connectionId, { wabaSubscriptionCompletedAt: new Date(), clearFinalizationLastError: true });
  }
  const connection = await input.repository.findByConnectionId(input.tenant, setup.connection.connectionId);
  return { connectionId: setup.connection.connectionId, publicWebhookId: connection?.publicWebhookId ?? "" };
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11K-M4 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const migrationStatus = await getDatabaseMigrationStatus();
  add("No Phase 11K-M4 migration is pending or required", migrationStatus.applied.includes("0013") && migrationStatus.pending.length === 0);

  let registrationPathname: string | null = null;
  let registrationContentType: string | null = null;
  let registrationAuthorization: string | null = null;
  let registrationBody: Record<string, unknown> = {};
  const registrationFetch: typeof fetch = async (input, init) => {
    registrationPathname = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    registrationContentType = headers.get("content-type");
    registrationAuthorization = headers.get("authorization");
    registrationBody = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : {};
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await new FetchManualMetaAppTransport("v25.0", registrationFetch).registerPhoneNumber(
    "123456789000002",
    "123456",
    "system_token_phase11k_m4",
  );
  add("phone registration transport uses Meta's JSON request contract",
    registrationContentType === "application/json"
    && registrationBody.messaging_product === "whatsapp"
    && registrationBody.pin === "123456");
  add("phone registration transport uses the requested phone edge and passed token",
    registrationPathname === "/v25.0/123456789000002/register"
    && registrationAuthorization === "Bearer system_token_phase11k_m4");

  let pinUpdatePathname: string | null = null;
  let pinUpdateContentType: string | null = null;
  let pinUpdateBody: Record<string, unknown> = {};
  const pinUpdateFetch: typeof fetch = async (input, init) => {
    pinUpdatePathname = new URL(String(input)).pathname;
    pinUpdateContentType = new Headers(init?.headers).get("content-type");
    pinUpdateBody = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : {};
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await new FetchManualMetaAppTransport("v25.0", pinUpdateFetch).setPhoneTwoStepVerificationPin(
    "123456789000002",
    "123456",
    "system_token_phase11k_m4",
  );
  add("two-step PIN recovery uses Meta's phone JSON endpoint",
    pinUpdatePathname === "/v25.0/123456789000002"
    && pinUpdateContentType === "application/json"
    && pinUpdateBody.pin === "123456");

  let registrationReadFields: string | null = null;
  const registrationReadFetch: typeof fetch = async (input) => {
    registrationReadFields = new URL(String(input)).searchParams.get("fields");
    return new Response(JSON.stringify({
      id: "123456789000002",
      status: "CONNECTED",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const registrationRead = await new FetchManualMetaAppTransport(
    "v25.0",
    registrationReadFetch,
  ).readPhoneRegistrationStatus(
    "123456789000002",
    "system_token_phase11k_m4",
  );
  add("registration readback uses the supported phone connection status",
    registrationReadFields === "id,status"
    && registrationRead.registered === true);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const encryption = encryptionService();
  const setupService = new ManualConnectionSetupService(repository, encryption, new FakeManualFinalizationTransport());
  const appSecret = "safe_fake_app_secret_phase11k_m4";
  const systemToken = "safe_fake_system_user_token_phase11k_m4";

  try {
    const sellerReady = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, sellerReady);
    const tenantReady = createTenantContext(sellerReady);
    const ready = await makeReadyManual({ repository, setupService, tenant: tenantReady, appSecret, systemToken });
    const readyTransport = new FakeManualFinalizationTransport();
    readyTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${ready.publicWebhookId}` }];
    const finalizeService = new ManualConnectionFinalizationService(repository, encryption, readyTransport, "https://backend.example");
    const finalized = await finalizeService.finalize(tenantReady, ready.connectionId);
    add("M4 finalization accepts two WhatsApp permissions", finalized.connection.status === "ACTIVE" && readyTransport.inspection.scopes.length === MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required.length);
    add("missing only optional business_management finalizes successfully", finalized.connection.status === "ACTIVE");
    add("finalization directly re-verifies persisted assets without assigned-WABA enumeration", readyTransport.assignedWabaListCalls === 0 && readyTransport.directWabaReads.length === 1 && readyTransport.directPhoneReads.length === 1);
    add("finalization asset re-verification uses only the stored System User token", readyTransport.directWabaReads[0]?.token === systemToken && readyTransport.directPhoneReads[0]?.token === systemToken);
    add("fully ready manual connection passes and becomes ACTIVE", finalized.connection.status === "ACTIVE" && finalized.health.status === "HEALTHY");
    const activeReady = await repository.findByConnectionId(tenantReady, ready.connectionId);
    add("connected_at and last_verified_at set", Boolean(activeReady?.connectedAt) && Boolean(activeReady?.lastVerifiedAt));
    add("same finalize retry is idempotent", (await finalizeService.finalize(tenantReady, ready.connectionId)).connection.connectionId === ready.connectionId);
    add("current-status response is secret-free and exposes safe manual method", !/safe_fake|encrypted|fingerprint|token|secret/i.test(JSON.stringify(await new WhatsAppConnectionCurrentService(repository).getCurrent(tenantReady))));

    const allScopesSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, allScopesSeller);
    const allScopesTenant = createTenantContext(allScopesSeller);
    const allScopesReady = await makeReadyManual({ repository, setupService, tenant: allScopesTenant, appSecret, systemToken, phoneNumberId: "123456789000010" });
    const allScopesTransport = new FakeManualFinalizationTransport();
    allScopesTransport.inspection = { ...allScopesTransport.inspection, scopes: [...MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required, ...MANUAL_SYSTEM_USER_SCOPE_CONTRACT.optional] };
    allScopesTransport.phones = new Map([["123456789000001", [{ id: "123456789000010", wabaId: "123456789000001" }]]]);
    allScopesTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${allScopesReady.publicWebhookId}` }];
    add("M4 finalization accepts all three permissions", (await new ManualConnectionFinalizationService(repository, encryption, allScopesTransport, "https://backend.example").finalize(allScopesTenant, allScopesReady.connectionId)).connection.status === "ACTIVE");

    const failureSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, failureSeller);
    const failureTenant = createTenantContext(failureSeller);
    const failure = await makeReadyManual({ repository, setupService, tenant: failureTenant, appSecret, systemToken, phoneNumberId: "123456789000003" });
    const failureTransport = failureReadyTransport(failure.publicWebhookId, "123456789000003");
    add("invalid token fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { inspection: { ...failureTransport.inspection, valid: false } }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_TOKEN_INVALID");
    add("expired token fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { inspection: { ...failureTransport.inspection, expiresAt: new Date(Date.now() - 1000) } }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_TOKEN_EXPIRED");
    add("App mismatch fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { inspection: { ...failureTransport.inspection, appId: "999999999999999" } }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_TOKEN_APP_MISMATCH");
    add("missing whatsapp_business_management fails finalization", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { inspection: { ...failureTransport.inspection, scopes: MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required.filter((scope) => scope !== "whatsapp_business_management") } }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_PERMISSION_MISSING");
    add("missing whatsapp_business_messaging fails finalization", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { inspection: { ...failureTransport.inspection, scopes: MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required.filter((scope) => scope !== "whatsapp_business_messaging") } }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_PERMISSION_MISSING");
    add("WABA access denial fails closed during finalization", await issue(() => {
      const denied = new FakeManualFinalizationTransport();
      denied.readWaba = async () => {
        throw new WhatsAppConnectionMetaTransportError("auth");
      };
      return new ManualConnectionFinalizationService(repository, encryption, denied, "https://backend.example").finalize(failureTenant, failure.connectionId);
    }) === "META_WABA_ACCESS_MISSING");
    add("WABA access lost fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { wabas: [] }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_WABA_ACCESS_MISSING");
    add("phone access lost fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(new FakeManualFinalizationTransport(), { phones: new Map([["123456789000001", []]]) }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_PHONE_ACCESS_MISSING");
    add("phone belonging to another WABA fails closed during finalization", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(failureReadyTransport(failure.publicWebhookId, "123456789000003"), {
      phones: new Map([["123456789000001", [{ id: "123456789000003", wabaId: "123456789000099" }]]]),
    }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "META_PHONE_ACCESS_MISSING");
    const noWebhook = await makeReadyManual({ repository, setupService, tenant: failureTenant, appSecret, systemToken, phoneNumberId: "123456789000004", markWebhook: false });
    add("webhook marker missing fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, failureReadyTransport(noWebhook.publicWebhookId, "123456789000004"), "https://backend.example").finalize(failureTenant, noWebhook.connectionId)) === "WEBHOOK_NOT_CONFIGURED");
    add("expected subscription missing fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(failureReadyTransport(failure.publicWebhookId, "123456789000003"), { subscriptions: [] }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "WEBHOOK_SUBSCRIPTION_UNCONFIRMED");
    add("wrong subscribed app fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(failureReadyTransport(failure.publicWebhookId, "123456789000003"), { subscriptions: [{ appId: "wrong", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${failure.publicWebhookId}` }] }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "WEBHOOK_SUBSCRIPTION_UNCONFIRMED");
    add("same subscribed app without the exact callback override fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, Object.assign(failureReadyTransport(failure.publicWebhookId, "123456789000003"), { subscriptions: [{ appId: "123456789012345" }] }), "https://backend.example").finalize(failureTenant, failure.connectionId)) === "WEBHOOK_SUBSCRIPTION_UNCONFIRMED");
    add("invalid public URL fails", await issue(() => new ManualConnectionFinalizationService(repository, encryption, failureTransport, "http://backend.example").finalize(failureTenant, failure.connectionId)) === "WEBHOOK_PUBLIC_URL_INVALID");

    const regSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, regSeller);
    const regTenant = createTenantContext(regSeller);
    const reg = await makeReadyManual({ repository, setupService, tenant: regTenant, appSecret, systemToken, phoneNumberId: "123456789000005" });
    const regTransport = new FakeManualFinalizationTransport();
    regTransport.registration = { id: "123456789000005", registered: false };
    regTransport.phones = new Map([["123456789000001", [{ id: "123456789000005", wabaId: "123456789000001" }]]]);
    regTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${reg.publicWebhookId}` }];
    await new ManualConnectionFinalizationService(repository, encryption, regTransport, "https://backend.example").finalize(regTenant, reg.connectionId);
    const storedPin = await repository.findRegistrationPinStorage(regTenant, reg.connectionId);
    add("unregistered phone registers with seller token", regTransport.registerCalls[0]?.token === systemToken && regTransport.registerCalls[0]?.phoneNumberId === "123456789000005");
    add("registration PIN is encrypted and never returned", Boolean(storedPin?.encryptedRegistrationPin) && storedPin?.encryptedRegistrationPin !== regTransport.registerCalls[0]?.pin && !JSON.stringify(await repository.findByConnectionId(regTenant, reg.connectionId)).includes(regTransport.registerCalls[0]?.pin ?? "pin"));
    const pinBeforeRetry = storedPin?.encryptedRegistrationPin;
    await new ManualConnectionFinalizationService(repository, encryption, regTransport, "https://backend.example").finalize(regTenant, reg.connectionId);
    add("harmless retry does not generate a new PIN", (await repository.findRegistrationPinStorage(regTenant, reg.connectionId))?.encryptedRegistrationPin === pinBeforeRetry);
    const pinMismatchSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, pinMismatchSeller);
    const pinMismatchTenant = createTenantContext(pinMismatchSeller);
    const pinMismatch = await makeReadyManual({ repository, setupService, tenant: pinMismatchTenant, appSecret, systemToken, phoneNumberId: "123456789000011" });
    const pinMismatchTransport = new FakeManualFinalizationTransport();
    pinMismatchTransport.registration = { id: "123456789000011", registered: false };
    pinMismatchTransport.phones = new Map([["123456789000001", [{ id: "123456789000011", wabaId: "123456789000001" }]]]);
    pinMismatchTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${pinMismatch.publicWebhookId}` }];
    pinMismatchTransport.registerError = "validation";
    pinMismatchTransport.registerMetaErrorCode = 133005;
    const recoveredPinMismatch = await new ManualConnectionFinalizationService(repository, encryption, pinMismatchTransport, "https://backend.example").finalize(pinMismatchTenant, pinMismatch.connectionId);
    add("Meta 133005 resets the encrypted two-step PIN and retries registration once",
      recoveredPinMismatch.connection.status === "ACTIVE"
      && pinMismatchTransport.setTwoStepPinCalls.length === 1
      && pinMismatchTransport.registerCalls.length === 2
      && pinMismatchTransport.setTwoStepPinCalls[0]?.pin === pinMismatchTransport.registerCalls[0]?.pin
      && pinMismatchTransport.setTwoStepPinCalls[0]?.token === systemToken);
    const timeoutSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, timeoutSeller);
    const timeoutTenant = createTenantContext(timeoutSeller);
    const timeout = await makeReadyManual({ repository, setupService, tenant: timeoutTenant, appSecret, systemToken, phoneNumberId: "123456789000006" });
    const timeoutTransport = new FakeManualFinalizationTransport();
    timeoutTransport.registration = { id: "123456789000006", registered: false };
    timeoutTransport.phones = new Map([["123456789000001", [{ id: "123456789000006", wabaId: "123456789000001" }]]]);
    timeoutTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${timeout.publicWebhookId}` }];
    timeoutTransport.registerError = "unavailable";
    add("ambiguous timeout with successful readback resumes", (await new ManualConnectionFinalizationService(repository, encryption, timeoutTransport, "https://backend.example").finalize(timeoutTenant, timeout.connectionId)).connection.status === "ACTIVE");
    const failedRegSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, failedRegSeller);
    const failedRegTenant = createTenantContext(failedRegSeller);
    const failedReg = await makeReadyManual({ repository, setupService, tenant: failedRegTenant, appSecret, systemToken, phoneNumberId: "123456789000007" });
    const failedRegTransport = new FakeManualFinalizationTransport();
    failedRegTransport.registration = { id: "123456789000007", registered: false };
    failedRegTransport.phones = new Map([["123456789000001", [{ id: "123456789000007", wabaId: "123456789000001" }]]]);
    failedRegTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${failedReg.publicWebhookId}` }];
    failedRegTransport.registerError = "validation";
    add("failed registration does not activate", await issue(() => new ManualConnectionFinalizationService(repository, encryption, failedRegTransport, "https://backend.example").finalize(failedRegTenant, failedReg.connectionId)) === "META_PHONE_REGISTRATION_FAILED" && (await repository.findByConnectionId(failedRegTenant, failedReg.connectionId))?.status === "VERIFYING");

    const replaceSeller = uniqueId("seller_phase11k_m4");
    await createSeller(sellerService, replaceSeller);
    const replaceTenant = createTenantContext(replaceSeller);
    const old = await repository.createCandidate(replaceTenant);
    await repository.persistVerifiedMetadata(replaceTenant, old.connectionId, { phoneNumberId: "999999999000001", displayPhoneNumber: "+212 600 000 999" });
    await repository.updateLifecycleStatus(replaceTenant, old.connectionId, "ACTIVE");
    const replacement = await makeReadyManual({ repository, setupService, tenant: replaceTenant, appSecret, systemToken, phoneNumberId: "123456789000008" });
    const replacementTransport = new FakeManualFinalizationTransport();
    replacementTransport.phones = new Map([["123456789000001", [{ id: "123456789000008", wabaId: "123456789000001" }]]]);
    replacementTransport.subscriptions = [{ appId: "123456789012345", callbackUrl: `https://backend.example/api/whatsapp/webhooks/connections/${replacement.publicWebhookId}` }];
    const replaced = await new ManualConnectionFinalizationService(repository, encryption, replacementTransport, "https://backend.example").finalize(replaceTenant, replacement.connectionId);
    add("successful replacement switches atomically", replaced.replacedPreviousConnection === true && (await repository.findByConnectionId(replaceTenant, old.connectionId))?.status === "DISCONNECTED" && (await repository.findActiveBySeller(replaceTenant))?.connectionId === replacement.connectionId);
    const blockedReplace = await makeReadyManual({ repository, setupService, tenant: replaceTenant, appSecret, systemToken, phoneNumberId: "123456789000009" });
    const blockedTransport = new FakeManualFinalizationTransport();
    blockedTransport.phones = new Map([["123456789000001", [{ id: "123456789000009", wabaId: "123456789000001" }]]]);
    blockedTransport.wabas = [];
    add("failed replacement keeps old ACTIVE", await issue(() => new ManualConnectionFinalizationService(repository, encryption, blockedTransport, "https://backend.example").finalize(replaceTenant, blockedReplace.connectionId)) === "META_WABA_ACCESS_MISSING" && (await repository.findActiveBySeller(replaceTenant))?.connectionId === replacement.connectionId);
    add("another seller cannot finalize", await issue(() => finalizeService.finalize(createTenantContext(replaceSeller), ready.connectionId)) === "MANUAL_CONNECTION_NOT_READY");

    const resolver = new PersistentWhatsAppOutboundConnectionResolver(repository, new WhatsAppConnectionCredentialService(repository, encryption), encryption);
    const outbound = await resolver.resolveForTrustedSeller(sellerReady);
    add("ACTIVE manual connection resolves its System User Token", outbound.accessToken === systemToken);
    add("manual outbound token provenance is the encrypted connection credential", outbound.tokenSource === "encrypted_connection_token");
    add("correct seller phone_number_id is used and App Secret is not used outbound", outbound.phoneNumberId === "123456789000002" && outbound.accessToken !== appSecret);
    add("inactive manual connection fails closed for outbound", await outboundIssue(() => resolver.resolveForTrustedSeller(failedRegSeller)) === "missing_active_connection");

    const previousQueueEnabled = env.whatsappInboundQueueEnabled;
    const previousGlobalAccessToken = env.whatsappCloudAccessToken;
    const producer = new FakeProducer();
    try {
      env.whatsappInboundQueueEnabled = true;
      setWhatsAppInboundProducerProviderForTesting(() => producer as unknown as WhatsAppInboundProducerService);
      setCloudWebhookProcessorForTesting(async () => ({ ok: true, handled: false, actionsCount: 0, sendAttempted: false, sendSuccess: false, outboundMessages: [] }));
      const publicController = new ManualWebhookPublicController(repository, encryption);
      const activeRaw = Buffer.from(JSON.stringify(webhookBody("123456789000001", "123456789000002", "msg_m4_active")));
      await invokePost(publicController, ready.publicWebhookId, activeRaw, appSecret);
      add("ACTIVE manual signed webhook reaches existing pipeline once", producer.jobs.filter((job) => job.messageId === "msg_m4_active").length === 1);
      const verifyingRaw = Buffer.from(JSON.stringify(webhookBody("123456789000001", "123456789000007", "msg_m4_verifying")));
      await invokePost(publicController, failedReg.publicWebhookId, verifyingRaw, appSecret);
      add("VERIFYING connection never enqueues", !producer.jobs.some((job) => job.messageId === "msg_m4_verifying"));

      const expiredGlobalTokenSentinel = "expired_global_token_must_not_be_used_phase11k_m4";
      env.whatsappInboundQueueEnabled = false;
      env.whatsappCloudAccessToken = expiredGlobalTokenSentinel;
      let directProcessorOptions: ProcessCloudWebhookOptions | undefined;
      let directProcessorCalls = 0;
      setCloudWebhookProcessorForTesting(async (_body, options) => {
        directProcessorCalls += 1;
        directProcessorOptions = options;
        return { ok: true, handled: false, actionsCount: 0, sendAttempted: false, sendSuccess: false, outboundMessages: [] };
      });
      const directRaw = Buffer.from(JSON.stringify(webhookBody("123456789000001", "123456789000002", "msg_m4_direct")));
      const tokenDecryptionsBeforeDirectPath = encryption.systemUserAccessTokenDecryptions;
      const directResponse = await invokePost(publicController, ready.publicWebhookId, directRaw, appSecret);
      const directRuntime = directProcessorOptions?.connectionScopedRuntime;
      add("queue-disabled manual public webhook supplies the stored connection runtime directly", directResponse.statusCode === 200 && directProcessorCalls === 1 && encryption.systemUserAccessTokenDecryptions === tokenDecryptionsBeforeDirectPath + 1 && Boolean(activeReady) && directRuntime?.accessToken === systemToken && directRuntime.tokenSource === "encrypted_connection_token" && directRuntime.phoneNumberId === activeReady?.phoneNumberId && directRuntime.connectionId === activeReady?.connectionId && directRuntime.sellerId === activeReady?.sellerId && !Object.is(directRuntime.accessToken, expiredGlobalTokenSentinel));

      const tokenDecryptionsBeforeInvalidSignature = encryption.systemUserAccessTokenDecryptions;
      const invalidSignatureResponse = await invokePost(publicController, ready.publicWebhookId, directRaw, "wrong_signature_secret_phase11k_m4");
      add("invalid manual webhook signature never decrypts the System User token", invalidSignatureResponse.statusCode === 403 && encryption.systemUserAccessTokenDecryptions === tokenDecryptionsBeforeInvalidSignature && directProcessorCalls === 1);
    } finally {
      env.whatsappInboundQueueEnabled = previousQueueEnabled;
      env.whatsappCloudAccessToken = previousGlobalAccessToken;
      setWhatsAppInboundProducerProviderForTesting(undefined);
      setCloudWebhookProcessorForTesting(undefined);
    }

    add("OWNER and ADMIN may finalize while AGENT and VIEWER may not", roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage") && !roleHasPermission("AGENT", "whatsapp_connection.manage") && !roleHasPermission("VIEWER", "whatsapp_connection.manage"));
    add("strict body rejects unknown fields and sellerId", await controllerRejects({ sellerId: sellerReady }) && await controllerRejects({ force: true }) && await controllerRejects({ appSecret }));
  } finally {
    await cleanup();
    const remainingConnections = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("Only Phase 11K-M4 test rows are cleaned up", remainingConnections.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

async function outboundIssue(callback: () => Promise<unknown>): Promise<string | null> {
  try {
    await callback();
    return null;
  } catch (error) {
    return error instanceof Error && "category" in error && typeof error.category === "string" ? error.category : "unexpected";
  }
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11K-M4 manual finalization test failed safely.", error: error instanceof Error ? error.name : "unknown" })}\n`);
  process.exitCode = 1;
});
