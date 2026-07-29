import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, getDatabaseMigrationStatus, getDatabasePoolState } from "../../../infrastructure/database";
import { roleHasPermission } from "../../auth";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ManualConnectionAssetsService } from "../application/manual-connection-assets.service";
import { MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES, MANUAL_SYSTEM_USER_SCOPE_CONTRACT } from "../application/manual-system-user-token-validation";
import { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import {
  setWhatsAppConnectionOperationalRecorderForTesting,
  type WhatsAppConnectionOperationalPayload,
} from "../application/whatsapp-connection-operational-events";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import { ManualConnectionValidationError, WhatsAppConnectionCompletionConflictError, WhatsAppConnectionMetaTransportError, WhatsAppConnectionValidationError } from "../domain/whatsapp-connection.errors";
import type { ManualMetaAppTransport, ManualMetaPhoneNumber, ManualMetaTokenInspectionResult, ManualMetaWaba } from "../infrastructure/meta/manual-meta-app.transport";
import { __phase11kM2ManualMetaTransportTesting, FetchManualMetaAppTransport } from "../infrastructure/meta/manual-meta-app.transport";
import { PostgreSqlWhatsAppConnectionRepository } from "../infrastructure/postgresql/postgresql-whatsapp-connection.repository";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];
const operationalEvents: Array<Readonly<{ name: string; payload: WhatsAppConnectionOperationalPayload }>> = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function encryptionService(keyVersion = "phase11k_m2", key = randomBytes(32).toString("base64")): WhatsAppConnectionCredentialEncryptionService {
  return new WhatsAppConnectionCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: keyVersion,
    keysJson: JSON.stringify({ [keyVersion]: key }),
  }));
}

class FakeManualMetaTransport implements ManualMetaAppTransport {
  inspection: ManualMetaTokenInspectionResult = {
    valid: true,
    appId: "123456789012345",
    type: "SYSTEM_USER",
    scopes: MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES,
    expiresAt: new Date(Date.now() + 86_400_000),
    systemUserId: "system_user_phase11k_m2",
  };
  wabas: ManualMetaWaba[] = [
    { id: "100000000000001", name: "Atlas WABA", accountStatus: "ACTIVE" },
    { id: "100000000000002", name: "Rif WABA", accountStatus: "ACTIVE" },
  ];
  phones = new Map<string, ManualMetaPhoneNumber[]>([
    ["100000000000001", [
      { id: "200000000000001", wabaId: "100000000000001", displayPhoneNumber: "+212 600 000 222", verifiedName: "Atlas Shop", status: "CONNECTED", codeVerificationStatus: "VERIFIED" },
      { id: "200000000000002", wabaId: "100000000000001", displayPhoneNumber: "+212 600 000 333", verifiedName: "Atlas Backup", status: "CONNECTED", codeVerificationStatus: "VERIFIED" },
    ]],
    ["100000000000002", [
      { id: "200000000000003", wabaId: "100000000000002", displayPhoneNumber: "+212 600 000 444", verifiedName: "Rif Shop", status: "CONNECTED", codeVerificationStatus: "VERIFIED" },
    ]],
  ]);
  inspected = 0;
  assignedWabaReads = 0;
  directWabaReads = 0;
  phoneReads = 0;
  directPhoneReads = 0;
  inspectedTokens: string[] = [];
  assignedWabaTokens: string[] = [];
  directWabaTokens: string[] = [];
  phoneListTokens: string[] = [];
  directPhoneTokens: string[] = [];

  async inspectSystemUserToken(appId: string, _appSecret: string, systemUserAccessToken: string): Promise<ManualMetaTokenInspectionResult> {
    this.inspected += 1;
    this.inspectedTokens.push(systemUserAccessToken);
    return { ...this.inspection, appId: this.inspection.appId ?? appId };
  }

  async listAssignedWabas(_systemUserId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWaba[]> {
    this.assignedWabaReads += 1;
    this.assignedWabaTokens.push(systemUserAccessToken);
    return this.wabas;
  }

  async readWaba(wabaId: string, systemUserAccessToken: string): Promise<ManualMetaWaba> {
    this.directWabaReads += 1;
    this.directWabaTokens.push(systemUserAccessToken);
    const waba = this.wabas.find((candidate) => candidate.id === wabaId);
    if (!waba) throw new WhatsAppConnectionMetaTransportError("not_found");
    return waba;
  }

  async listPhoneNumbers(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaPhoneNumber[]> {
    this.phoneReads += 1;
    this.phoneListTokens.push(systemUserAccessToken);
    return this.phones.get(wabaId) ?? [];
  }

  async readPhoneNumber(phoneNumberId: string, systemUserAccessToken: string): Promise<ManualMetaPhoneNumber> {
    this.directPhoneReads += 1;
    this.directPhoneTokens.push(systemUserAccessToken);
    const phone = [...this.phones.values()].flat().find((candidate) => candidate.id === phoneNumberId);
    if (!phone) {
      throw new WhatsAppConnectionMetaTransportError("not_found", { operation: "read_phone_number" });
    }
    return phone;
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
    return error instanceof ManualConnectionValidationError ? error.issueCode : "unexpected";
  }
}

async function rejectsMalformedInput(callback: () => Promise<unknown>): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof WhatsAppConnectionValidationError;
  }
}

async function controllerRejects(method: "discoverManualAssets" | "selectManualAssets", body: Record<string, unknown>): Promise<boolean> {
  const controller = new WhatsAppConnectionController({} as never, undefined, undefined, undefined, undefined, {
    discover: async () => ({ connectionId: "conn", validation: { valid: true, tokenType: "SYSTEM_USER", expiresAt: null }, wabas: [] }),
    selectAssets: async () => ({ connection: { connectionId: "conn", status: "VERIFYING", connectionMethod: "CUSTOMER_OWNED_META_APP", appId: "123", maskedPhoneNumber: null, verifiedName: null }, nextStep: "CONFIGURE_WEBHOOK" }),
  } as never);
  const res = responseProbe();
  await controller[method]({ body, params: { connectionId: "conn" }, tenant: createTenantContext("seller_phase11k_m2_controller") } as unknown as Request, res as Response);
  return res.statusCode === 400;
}

async function main(): Promise<void> {
  await closeDatabasePool();
  setWhatsAppConnectionOperationalRecorderForTesting({
    recordAudit: (name, payload) => {
      operationalEvents.push({ name, payload });
    },
    increment: () => undefined,
    observe: () => undefined,
  });
  add("Phase 11K-M2 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const migrationStatus = await getDatabaseMigrationStatus();
  add("No Phase 11K-M2 migration is pending or required", migrationStatus.applied.includes("0013") && migrationStatus.pending.length === 0);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const key = randomBytes(32).toString("base64");
  const encryption = encryptionService("phase11k_m2", key);
  const transport = new FakeManualMetaTransport();
  const setupService = new ManualConnectionSetupService(repository, encryption, transport);
  const assetsService = new ManualConnectionAssetsService(repository, encryption, transport);
  const sellerA = uniqueId("seller_phase11k_m2");
  const sellerB = uniqueId("seller_phase11k_m2");
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);
  currentSellerForInvalidIssue = sellerA;

  try {
    await createSeller(sellerService, sellerA);
    await createSeller(sellerService, sellerB);
    const active = await repository.createCandidate(tenantA);
    await repository.persistVerifiedMetadata(tenantA, active.connectionId, { phoneNumberId: "active_phase11k_m2", displayPhoneNumber: "+212 600 000 999" });
    const activated = await repository.updateLifecycleStatus(tenantA, active.connectionId, "ACTIVE");

    const originalSystemUserToken = "safe_fake_system_user_token_phase11k_m2";
    const setup = await setupService.setup(tenantA, {
      appId: "123456789012345",
      appSecret: "safe_fake_app_secret_phase11k_m2",
      systemUserAccessToken: originalSystemUserToken,
    });
    const discover = await assetsService.discover(tenantA, setup.connection.connectionId);
    const discoverPayload = JSON.stringify(discover);
    add("two WhatsApp permissions pass discovery", discover.validation.valid && transport.inspection.scopes.length === MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required.length);
    add("valid System User token succeeds", discover.validation.valid && discover.validation.tokenType === "SYSTEM_USER");
    add("assigned WABAs are returned safely", discover.wabas.length === 2 && discover.wabas[0]?.wabaId === "100000000000001");
    add("phone numbers are grouped under the correct WABA", discover.wabas[0]?.phoneNumbers.length === 2 && discover.wabas[1]?.phoneNumbers[0]?.phoneNumberId === "200000000000003");
    add("multiple WABAs and phones are supported", discoverPayload.includes("Rif WABA") && discoverPayload.includes("200000000000002"));
    add("discovery response contains no secrets or sellerId", !/safe_fake|system_user_token|app_secret|seller_phase11k|encrypted|fingerprint|fbtrace/i.test(discoverPayload));
    add("display phone numbers are masked", discover.wabas[0]?.phoneNumbers[0]?.maskedDisplayPhoneNumber === "••••••••0222" && !discoverPayload.includes("+212 600 000 222"));
    const tokenSourceEvent = operationalEvents.find((event) => event.name === "whatsapp_connection.manual_token_source_resolved");
    const tokenSourcePayload = JSON.stringify(tokenSourceEvent?.payload ?? {});
    add("asset validation records only the encrypted connection token provenance", Boolean(tokenSourceEvent) && Object.keys(tokenSourceEvent?.payload ?? {}).sort().join("|") === "timestamp|tokenSource" && tokenSourceEvent?.payload.tokenSource === "encrypted_connection_token" && !/safe_fake|system_user_token|app_secret|seller_phase11k|encryptedSystemUserAccessToken|fbtrace|100000000000001|200000000000001/u.test(tokenSourcePayload));

    let assignedWabaRequestUrl = "";
    let assignedWabaAuthorizationPresent = false;
    const assignedWabaToken = "safe_fake_assigned_waba_token_phase11k_m2";
    const fetchTransport = new FetchManualMetaAppTransport("v25.0", async (input, init) => {
      assignedWabaRequestUrl = String(input);
      assignedWabaAuthorizationPresent = new Headers(init?.headers).get("Authorization") === `Bearer ${assignedWabaToken}`;
      return new Response(JSON.stringify({ data: [{ id: "100000000000001", name: "Atlas WABA", account_status: "ACTIVE" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const fetchedAssignedWabas = await fetchTransport.listAssignedWabas("300000000000001", assignedWabaToken);
    const assignedWabaUrl = new URL(assignedWabaRequestUrl);
    add("automatic discovery uses the token-compatible me assigned-WABA edge", assignedWabaUrl.pathname === "/v25.0/me/assigned_whatsapp_business_accounts" && assignedWabaUrl.searchParams.get("fields") === "id,name" && fetchedAssignedWabas[0]?.id === "100000000000001");
    add("assigned-WABA request uses bearer auth without placing the token in the URL", assignedWabaAuthorizationPresent && !assignedWabaRequestUrl.includes(assignedWabaToken) && !assignedWabaUrl.searchParams.has("access_token"));
    let inspectionRequestUrl = "";
    let inspectionAuthorization = "";
    let oauthRequestValid = false;
    const inspectionAppSecret = "safe_fake_inspection_app_secret+value=/&";
    const inspectionSystemToken = "safe_fake_inspection_system_token";
    const acquiredAppAccessToken = "safe_fake_acquired_app_access_token";
    const inspectionTransport = new FetchManualMetaAppTransport("v25.0", async (input, init) => {
      const requestUrl = new URL(String(input));
      if (requestUrl.pathname === "/oauth/access_token") {
        oauthRequestValid = requestUrl.searchParams.get("client_id") === "123456789012345"
          && requestUrl.searchParams.get("client_secret") === inspectionAppSecret
          && requestUrl.searchParams.get("grant_type") === "client_credentials"
          && !new Headers(init?.headers).has("Authorization");
        return new Response(JSON.stringify({ access_token: acquiredAppAccessToken, token_type: "bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      inspectionRequestUrl = String(input);
      inspectionAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(JSON.stringify({
      data: {
        is_valid: true,
        app_id: "123456789012345",
        type: "SYSTEM_USER",
        user_id: "300000000000001",
        expires_at: 0,
        scopes: [],
        granular_scopes: [
          {
            scope: "whatsapp_business_management",
            target_ids: ["100000000000001", "100000000000002", "../invalid"],
          },
          { scope: "whatsapp_business_messaging", target_ids: [] },
          { scope: "whatsapp_business_messaging", target_ids: [] },
        ],
      },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const tokenInspection = await inspectionTransport.inspectSystemUserToken(
      "123456789012345",
      inspectionAppSecret,
      inspectionSystemToken,
    );
    const inspectionUrl = new URL(inspectionRequestUrl);
    add("App credentials are URL encoded into a separate bounded OAuth acquisition", oauthRequestValid);
    add("debug-token uses only the acquired App access token as bearer auth", inspectionAuthorization === `Bearer ${acquiredAppAccessToken}` && !inspectionRequestUrl.includes(inspectionAppSecret) && !inspectionUrl.searchParams.has("access_token") && inspectionUrl.searchParams.get("input_token") === inspectionSystemToken);
    add("token inspection safely extracts only valid WhatsApp assignment targets", tokenInspection.assignedWabaIds?.length === 2 && tokenInspection.assignedWabaIds[0] === "100000000000001");
    add("granular-only token scopes are merged, bounded, and deduplicated", tokenInspection.scopes.length === 2 && MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES.every((scope) => tokenInspection.scopes.includes(scope)));
    add("expires_at zero is explicitly represented as non-expiring", tokenInspection.expiresAt === null);

    const oauthFailureSecret = "safe_fake_oauth_failure_secret";
    const oauthFailureInputToken = "safe_fake_oauth_failure_input_token";
    const oauthFailureTransport = new FetchManualMetaAppTransport("v25.0", async () => new Response(JSON.stringify({
      error: {
        code: 190,
        error_subcode: 467,
        message: "raw_oauth_failure_message",
        type: "OAuthException",
        fbtrace_id: "raw_oauth_failure_trace",
      },
    }), { status: 400, headers: { "Content-Type": "application/json" } }));
    let oauthFailureText = "";
    try {
      await oauthFailureTransport.inspectSystemUserToken(
        "123456789012345",
        oauthFailureSecret,
        oauthFailureInputToken,
      );
    } catch (error) {
      oauthFailureText = JSON.stringify({
        operation: error instanceof WhatsAppConnectionMetaTransportError ? error.operation : "unknown",
        httpStatus: error instanceof WhatsAppConnectionMetaTransportError ? error.httpStatus : "unknown",
        metaErrorCode: error instanceof WhatsAppConnectionMetaTransportError ? error.metaErrorCode : "unknown",
        metaErrorSubcode: error instanceof WhatsAppConnectionMetaTransportError ? error.metaErrorSubcode : "unknown",
      });
    }
    add("OAuth acquisition errors retain only bounded numeric diagnostics", oauthFailureText.includes("\"operation\":\"acquire_app_access_token\"") && oauthFailureText.includes("\"httpStatus\":400") && oauthFailureText.includes("\"metaErrorCode\":190") && oauthFailureText.includes("\"metaErrorSubcode\":467") && !/safe_fake|raw_oauth|OAuthException|fbtrace/u.test(oauthFailureText));

    const rejectedAcquiredToken = "safe_fake_rejected_acquired_app_token";
    const debugFailureTransport = new FetchManualMetaAppTransport("v25.0", async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: rejectedAcquiredToken, token_type: "bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        error: {
          code: 190,
          error_subcode: 463,
          message: "raw_debug_failure_message",
          fbtrace_id: "raw_debug_failure_trace",
        },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
    });
    let debugFailureText = "";
    try {
      await debugFailureTransport.inspectSystemUserToken(
        "123456789012345",
        "safe_fake_debug_failure_secret",
        "safe_fake_debug_failure_input_token",
      );
    } catch (error) {
      debugFailureText = JSON.stringify({
        operation: error instanceof WhatsAppConnectionMetaTransportError ? error.operation : "unknown",
        httpStatus: error instanceof WhatsAppConnectionMetaTransportError ? error.httpStatus : "unknown",
        metaErrorCode: error instanceof WhatsAppConnectionMetaTransportError ? error.metaErrorCode : "unknown",
        metaErrorSubcode: error instanceof WhatsAppConnectionMetaTransportError ? error.metaErrorSubcode : "unknown",
      });
    }
    add("rejected acquired App tokens and debug payloads never enter diagnostics", debugFailureText.includes("\"operation\":\"inspect_system_user_token\"") && debugFailureText.includes("\"metaErrorSubcode\":463") && !/safe_fake|raw_debug|fbtrace/u.test(debugFailureText));

    const requestedFields = new Map<string, string | null>();
    const schemaTransport = new FetchManualMetaAppTransport("v25.0", async (input) => {
      const url = new URL(String(input));
      requestedFields.set(url.pathname, url.searchParams.get("fields"));
      if (url.pathname.endsWith("/phone_numbers")) {
        return new Response(JSON.stringify({ data: [{
          id: "200000000000001",
          display_phone_number: "+212 600 000 222",
          verified_name: "Atlas Shop",
          quality_rating: "GREEN",
          status: "CONNECTED",
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname.endsWith("/200000000000001")) {
        return new Response(JSON.stringify({
          id: "200000000000001",
          display_phone_number: "+212 600 000 222",
          verified_name: "Atlas Shop",
          quality_rating: "GREEN",
          status: "CONNECTED",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "100000000000001", name: "Atlas WABA" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const schemaWaba = await schemaTransport.readWaba("100000000000001", assignedWabaToken);
    const schemaPhones = await schemaTransport.listPhoneNumbers("100000000000001", assignedWabaToken);
    const schemaPhone = await schemaTransport.readPhoneNumber("200000000000001", assignedWabaToken);
    add("v25 WABA reads request only supported identity fields", requestedFields.get("/v25.0/100000000000001") === "id,name" && schemaWaba.id === "100000000000001");
    add("v25 WABA phone listing uses the live-proven metadata fields", requestedFields.get("/v25.0/100000000000001/phone_numbers") === "id,display_phone_number,verified_name,quality_rating,status" && schemaPhones[0]?.qualityRating === "GREEN" && schemaPhones[0]?.status === "CONNECTED" && schemaPhones[0]?.codeVerificationStatus === null);
    add("direct phone verification uses only the live-proven metadata fields", requestedFields.get("/v25.0/200000000000001") === "id,display_phone_number,verified_name,quality_rating,status" && schemaPhone.qualityRating === "GREEN" && schemaPhone.status === "CONNECTED");

    const selected = await assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "100000000000001", phoneNumberId: "200000000000001" });
    add("verified WABA/phone pair persists successfully", selected.connection.status === "VERIFYING" && selected.connection.verifiedName === "Atlas Shop");
    add("selected draft becomes VERIFYING and next step is webhook configuration", selected.nextStep === "CONFIGURE_WEBHOOK");
    add("selection response contains no secret or unmasked phone", !/safe_fake|system_user_token|app_secret|\+212 600 000 222|seller_phase11k/i.test(JSON.stringify(selected)));
    add("existing ACTIVE connection remains unchanged", (await repository.findActiveBySeller(tenantA))?.connectionId === activated?.connectionId);
    add("same selection retry is idempotent", (await assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "100000000000001", phoneNumberId: "200000000000001" })).connection.connectionId === setup.connection.connectionId);
    add("changed selection while not activated is allowed", (await assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "100000000000002", phoneNumberId: "200000000000003" })).connection.verifiedName === "Rif Shop");

    const replacementSystemUserToken = "safe_fake_replacement_system_user_token_phase11k_m2";
    const replacedSetup = await setupService.replaceCredentials(tenantA, setup.connection.connectionId, {
      appId: "123456789012345",
      appSecret: "safe_fake_replacement_app_secret_phase11k_m2",
      systemUserAccessToken: replacementSystemUserToken,
    });
    const replacedDraft = await repository.findByConnectionId(tenantA, setup.connection.connectionId);
    add("credential replacement invalidates selected assets and restores PENDING", replacedSetup.connection.status === "PENDING" && replacedDraft?.status === "PENDING" && !replacedDraft.wabaId && !replacedDraft.phoneNumberId && !replacedDraft.displayPhoneNumber && !replacedDraft.verifiedName);
    transport.inspectedTokens = [];
    transport.assignedWabaTokens = [];
    transport.directWabaTokens = [];
    transport.phoneListTokens = [];
    transport.directPhoneTokens = [];
    const selectedWithReplacement = await assetsService.selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    });
    const postReplacementTokens: string[] = [
      ...transport.inspectedTokens,
      ...transport.assignedWabaTokens,
      ...transport.directWabaTokens,
      ...transport.phoneListTokens,
      ...transport.directPhoneTokens,
    ];
    add("manual verification decrypts and uses only the newest replacement token", selectedWithReplacement.connection.status === "VERIFYING" && postReplacementTokens.length === 4 && !postReplacementTokens.includes(originalSystemUserToken) && postReplacementTokens.every((token) => token === replacementSystemUserToken));

    const credentialRaceTransport = new FakeManualMetaTransport();
    const readPhoneBeforeCredentialRace = credentialRaceTransport.readPhoneNumber.bind(credentialRaceTransport);
    credentialRaceTransport.readPhoneNumber = async (phoneNumberId, systemUserAccessToken) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await setupService.replaceCredentials(tenantA, setup.connection.connectionId, {
        appId: "123456789012345",
        appSecret: "safe_fake_race_app_secret_phase11k_m2",
        systemUserAccessToken: "safe_fake_race_system_user_token_phase11k_m2",
      });
      return readPhoneBeforeCredentialRace(phoneNumberId, systemUserAccessToken);
    };
    add("credential replacement during Meta verification cannot persist stale asset metadata", await expectsConflict(() => new ManualConnectionAssetsService(repository, encryption, credentialRaceTransport).selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    })) && (await repository.findByConnectionId(tenantA, setup.connection.connectionId))?.status === "PENDING");

    add("invalid token fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { valid: false }) === "META_TOKEN_INVALID");
    add("expired token fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { expiresAt: new Date(Date.now() - 1000) }) === "META_TOKEN_EXPIRED");
    add("token App ID mismatch fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { appId: "999999999999999" }) === "META_TOKEN_APP_MISMATCH");
    add("unsupported token type fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { type: "USER" }) === "META_TOKEN_TYPE_UNSUPPORTED");
    add("all three permissions pass discovery", await issue(() => {
      const fake = new FakeManualMetaTransport();
      fake.inspection = { ...fake.inspection, scopes: [...MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required, ...MANUAL_SYSTEM_USER_SCOPE_CONTRACT.optional] };
      return new ManualConnectionAssetsService(repository, encryption, fake).discover(tenantA, setup.connection.connectionId);
    }) === null);
    add("missing only optional business_management succeeds", await invalidIssue(setup.connection.connectionId, repository, encryption, { scopes: MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES }) === null);
    const granularAssignmentTransport = new FakeManualMetaTransport();
    granularAssignmentTransport.inspection = {
      ...granularAssignmentTransport.inspection,
      scopes: MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES,
      assignedWabaIds: ["100000000000001", "100000000000002"],
    };
    granularAssignmentTransport.listAssignedWabas = async () => {
      throw new Error("assigned-WABA edge must not be called when token targets are available");
    };
    const granularAssignmentDiscovery = await new ManualConnectionAssetsService(repository, encryption, granularAssignmentTransport)
      .discover(tenantA, setup.connection.connectionId);
    add("two-scope token target assignments discover WABAs without portfolio enumeration", granularAssignmentDiscovery.wabas.length === 2 && granularAssignmentTransport.assignedWabaReads === 0 && granularAssignmentTransport.directWabaReads === 2);
    add("missing whatsapp_business_management fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { scopes: MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required.filter((scope) => scope !== "whatsapp_business_management") }) === "META_REQUIRED_PERMISSION_MISSING");
    add("missing whatsapp_business_messaging fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { scopes: MANUAL_SYSTEM_USER_SCOPE_CONTRACT.required.filter((scope) => scope !== "whatsapp_business_messaging") }) === "META_REQUIRED_PERMISSION_MISSING");
    add("App Secret/token decryption failure fails closed", await issue(() => new ManualConnectionAssetsService(repository, encryptionService("phase11k_wrong"), transport).discover(tenantA, setup.connection.connectionId)) === "META_APP_CREDENTIALS_INVALID");

    const noWaba = new FakeManualMetaTransport();
    noWaba.wabas = [];
    add("empty assigned-WABA enumeration opens the secure manual fallback", await issue(() => new ManualConnectionAssetsService(repository, encryption, noWaba).discover(tenantA, setup.connection.connectionId)) === "META_ASSET_DISCOVERY_FAILED");
    const deniedWaba = new FakeManualMetaTransport();
    deniedWaba.listAssignedWabas = async () => {
      throw new WhatsAppConnectionMetaTransportError("auth");
    };
    add("unsupported assigned-WABA listing returns the manual-fallback issue", await issue(() => new ManualConnectionAssetsService(repository, encryption, deniedWaba).discover(tenantA, setup.connection.connectionId)) === "META_ASSET_DISCOVERY_FAILED");
    const noPhones = new FakeManualMetaTransport();
    noPhones.phones = new Map(noPhones.wabas.map((waba) => [waba.id, []]));
    add("no phone numbers produces safe issue", await issue(() => new ManualConnectionAssetsService(repository, encryption, noPhones).discover(tenantA, setup.connection.connectionId)) === "META_PHONE_NOT_FOUND");
    add("pagination rejects untrusted origin", (() => {
      try {
        __phase11kM2ManualMetaTransportTesting.validatePagingOrigin("https://evil.example/page?after=x");
        return false;
      } catch {
        return true;
      }
    })());

    const automaticUnavailable = new FakeManualMetaTransport();
    automaticUnavailable.listAssignedWabas = async () => {
      throw new WhatsAppConnectionMetaTransportError("validation");
    };
    const fallbackService = new ManualConnectionAssetsService(repository, encryption, automaticUnavailable);
    const automaticUnavailableIssue = await issue(() => fallbackService.discover(tenantA, setup.connection.connectionId));
    const fallbackSelection = await fallbackService.selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    });
    add("manual WABA and phone verification works when automatic listing is unavailable", automaticUnavailableIssue === "META_ASSET_DISCOVERY_FAILED" && fallbackSelection.connection.verifiedName === "Atlas Shop" && automaticUnavailable.directWabaReads === 1 && automaticUnavailable.directPhoneReads === 1);

    const inaccessibleWaba = new FakeManualMetaTransport();
    inaccessibleWaba.readWaba = async () => {
      throw new WhatsAppConnectionMetaTransportError("validation", {
        operation: "read_waba",
        httpStatus: 400,
        metaErrorCode: 200,
        metaErrorSubcode: 321,
      });
    };
    const inaccessibleWabaIssue = await issue(() => new ManualConnectionAssetsService(repository, encryption, inaccessibleWaba).selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    }));
    add("direct verification of an inaccessible WABA fails closed", inaccessibleWabaIssue === "META_WABA_ACCESS_DENIED");
    const wabaDiagnostic = operationalEvents.find((event) => event.name === "whatsapp_connection.manual_meta_graph_failed" && event.payload.metaOperation === "read_waba" && event.payload.httpStatus === 400);
    const wabaDiagnosticPayload = JSON.stringify(wabaDiagnostic?.payload ?? {});
    add("Graph diagnostics contain only bounded operation, status, numeric code/subcode, issue, and timestamp", Boolean(wabaDiagnostic) && Object.keys(wabaDiagnostic?.payload ?? {}).sort().join("|") === "httpStatus|issueCode|metaErrorCode|metaErrorSubcode|metaOperation|timestamp" && wabaDiagnosticPayload.includes("\"metaErrorCode\":200") && wabaDiagnosticPayload.includes("\"metaErrorSubcode\":321") && wabaDiagnosticPayload.includes("\"issueCode\":\"META_WABA_ACCESS_DENIED\"") && !/safe_fake|token|app_secret|fbtrace|seller_phase11k|100000000000001/u.test(wabaDiagnosticPayload));
    const inaccessiblePhone = new FakeManualMetaTransport();
    inaccessiblePhone.readPhoneNumber = async () => {
      throw new WhatsAppConnectionMetaTransportError("auth", {
        operation: "read_phone_number",
        httpStatus: 403,
        metaErrorCode: 200,
      });
    };
    add("direct verification of an inaccessible phone has a dedicated safe issue", await issue(() => new ManualConnectionAssetsService(repository, encryption, inaccessiblePhone).selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    })) === "META_PHONE_ACCESS_DENIED");
    const rejectedPhoneRequest = new FakeManualMetaTransport();
    rejectedPhoneRequest.readPhoneNumber = async () => {
      throw new WhatsAppConnectionMetaTransportError("validation", {
        operation: "read_phone_number",
        httpStatus: 400,
        metaErrorCode: 100,
      });
    };
    add("non-auth Graph request rejection is not collapsed into discovery failure", await issue(() => new ManualConnectionAssetsService(repository, encryption, rejectedPhoneRequest).selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    })) === "META_GRAPH_REQUEST_REJECTED");
    add("phone must belong to selected WABA", await issue(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "100000000000001", phoneNumberId: "200000000000003" })) === "META_PHONE_WABA_MISMATCH");
    add("unlisted WABA is rejected", await issue(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "999000000000001", phoneNumberId: "200000000000001" })) === "META_WABA_NOT_FOUND");
    add("unlisted phone is rejected", await issue(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "100000000000001", phoneNumberId: "999000000000002" })) === "META_PHONE_NOT_FOUND");

    const mismatchedMetadata = new FakeManualMetaTransport();
    mismatchedMetadata.phones.set("100000000000001", [{
      id: "200000000000001",
      wabaId: "100000000000002",
      displayPhoneNumber: "+212 600 000 222",
      verifiedName: "Wrong WABA",
    }]);
    add("raw browser IDs cannot bypass verified WABA ownership metadata", await issue(() => new ManualConnectionAssetsService(repository, encryption, mismatchedMetadata).selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "200000000000001",
    })) === "META_PHONE_WABA_MISMATCH");

    const malformedTransport = new FakeManualMetaTransport();
    const malformedService = new ManualConnectionAssetsService(repository, encryption, malformedTransport);
    const malformedWabaRejected = await rejectsMalformedInput(() => malformedService.selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "../100000000000001",
      phoneNumberId: "200000000000001",
    }));
    const malformedPhoneRejected = await rejectsMalformedInput(() => malformedService.selectAssets(tenantA, setup.connection.connectionId, {
      wabaId: "100000000000001",
      phoneNumberId: "phone-not-an-id",
    }));
    add("malformed asset IDs fail before any Meta call", malformedWabaRejected && malformedPhoneRejected && malformedTransport.inspected === 0 && malformedTransport.directWabaReads === 0 && malformedTransport.phoneReads === 0 && malformedTransport.directPhoneReads === 0);

    let safeTransportError = "";
    const rawGraphFailure = new FetchManualMetaAppTransport("v25.0", async () => new Response(JSON.stringify({
      error: {
        code: 100,
        error_subcode: 33,
        message: "raw_graph_payload_marker",
        fbtrace_id: "raw_trace_marker",
      },
    }), { status: 400, headers: { "Content-Type": "application/json" } }));
    try {
      await rawGraphFailure.listAssignedWabas("300000000000001", "safe_fake_graph_failure_token");
    } catch (error) {
      safeTransportError = JSON.stringify({
        name: error instanceof Error ? error.name : "unknown",
        code: error instanceof WhatsAppConnectionMetaTransportError ? error.code : "unknown",
        operation: error instanceof WhatsAppConnectionMetaTransportError ? error.operation : "unknown",
        httpStatus: error instanceof WhatsAppConnectionMetaTransportError ? error.httpStatus : "unknown",
        metaErrorCode: error instanceof WhatsAppConnectionMetaTransportError ? error.metaErrorCode : "unknown",
        metaErrorSubcode: error instanceof WhatsAppConnectionMetaTransportError ? error.metaErrorSubcode : "unknown",
      });
    }
    add("Graph failures expose only bounded operation, HTTP status, and numeric Meta codes", safeTransportError.includes("\"validation\"") && safeTransportError.includes("\"list_assigned_wabas\"") && safeTransportError.includes("\"httpStatus\":400") && safeTransportError.includes("\"metaErrorCode\":100") && safeTransportError.includes("\"metaErrorSubcode\":33") && !/raw_graph_payload_marker|raw_trace_marker|safe_fake_graph_failure_token/u.test(safeTransportError));

    const other = await repository.createCandidate(tenantB);
    await repository.persistVerifiedMetadata(tenantB, other.connectionId, { phoneNumberId: "200000000000002" });
    await repository.updateLifecycleStatus(tenantB, other.connectionId, "VERIFYING");
    add("duplicate phone owned by another seller is rejected safely", await expectsConflict(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "100000000000001", phoneNumberId: "200000000000002" })));
    add("another seller cannot discover or select", await issue(() => assetsService.discover(tenantB, setup.connection.connectionId)) === "META_APP_CREDENTIALS_INVALID" && await issue(() => assetsService.selectAssets(tenantB, setup.connection.connectionId, { wabaId: "100000000000001", phoneNumberId: "200000000000001" })) === "META_APP_CREDENTIALS_INVALID");
    add("strict bodies reject unknown fields and sellerId", await controllerRejects("discoverManualAssets", { sellerId: sellerA }) && await controllerRejects("selectManualAssets", { wabaId: "1", phoneNumberId: "2", sellerId: sellerA }) && await controllerRejects("selectManualAssets", { wabaId: "1", phoneNumberId: "2", extra: true }));
    add("AGENT/VIEWER cannot use endpoints while OWNER/ADMIN can", !roleHasPermission("AGENT", "whatsapp_connection.manage") && !roleHasPermission("VIEWER", "whatsapp_connection.manage") && roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage"));
    add("current-status remains secret-free", !/safe_fake|encrypted|fingerprint|system_user|app_secret/i.test(JSON.stringify(await new WhatsAppConnectionCurrentService(repository).getCurrent(tenantA))));
  } finally {
    await cleanup();
    const remainingConnections = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("Only Phase 11K-M2 test rows are cleaned up", remainingConnections.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
    setWhatsAppConnectionOperationalRecorderForTesting(undefined);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

async function invalidIssue(connectionId: string, repository: PostgreSqlWhatsAppConnectionRepository, encryption: WhatsAppConnectionCredentialEncryptionService, override: Partial<ManualMetaTokenInspectionResult>): Promise<string | null> {
  const fake = new FakeManualMetaTransport();
  fake.inspection = { ...fake.inspection, ...override };
  return issue(() => new ManualConnectionAssetsService(repository, encryption, fake).discover(createTenantContext(currentSellerForInvalidIssue), connectionId));
}

let currentSellerForInvalidIssue = "";

async function expectsConflict(callback: () => Promise<unknown>): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof WhatsAppConnectionCompletionConflictError;
  }
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11K-M2 manual validation assets test failed safely.", error: error instanceof Error ? error.name : "unknown" })}\n`);
  process.exitCode = 1;
});
