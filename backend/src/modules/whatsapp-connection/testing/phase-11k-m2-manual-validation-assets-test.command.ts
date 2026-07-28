import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, getDatabaseMigrationStatus, getDatabasePoolState } from "../../../infrastructure/database";
import { roleHasPermission } from "../../auth";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ManualConnectionAssetsService } from "../application/manual-connection-assets.service";
import { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import { ManualConnectionValidationError, WhatsAppConnectionCompletionConflictError } from "../domain/whatsapp-connection.errors";
import type { ManualMetaAppTransport, ManualMetaPhoneNumber, ManualMetaTokenInspectionResult, ManualMetaWaba } from "../infrastructure/meta/manual-meta-app.transport";
import { __phase11kM2ManualMetaTransportTesting } from "../infrastructure/meta/manual-meta-app.transport";
import { PostgreSqlWhatsAppConnectionRepository } from "../infrastructure/postgresql/postgresql-whatsapp-connection.repository";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";

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
    scopes: ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"],
    expiresAt: new Date(Date.now() + 86_400_000),
    systemUserId: "system_user_phase11k_m2",
  };
  wabas: ManualMetaWaba[] = [
    { id: "waba_phase11k_m2_a", name: "Atlas WABA", accountStatus: "ACTIVE" },
    { id: "waba_phase11k_m2_b", name: "Rif WABA", accountStatus: "ACTIVE" },
  ];
  phones = new Map<string, ManualMetaPhoneNumber[]>([
    ["waba_phase11k_m2_a", [
      { id: "phone_phase11k_m2_a1", wabaId: "waba_phase11k_m2_a", displayPhoneNumber: "+212 600 000 222", verifiedName: "Atlas Shop", status: "CONNECTED", codeVerificationStatus: "VERIFIED" },
      { id: "phone_phase11k_m2_a2", wabaId: "waba_phase11k_m2_a", displayPhoneNumber: "+212 600 000 333", verifiedName: "Atlas Backup", status: "CONNECTED", codeVerificationStatus: "VERIFIED" },
    ]],
    ["waba_phase11k_m2_b", [
      { id: "phone_phase11k_m2_b1", wabaId: "waba_phase11k_m2_b", displayPhoneNumber: "+212 600 000 444", verifiedName: "Rif Shop", status: "CONNECTED", codeVerificationStatus: "VERIFIED" },
    ]],
  ]);
  inspected = 0;

  async inspectSystemUserToken(appId: string): Promise<ManualMetaTokenInspectionResult> {
    this.inspected += 1;
    return { ...this.inspection, appId: this.inspection.appId ?? appId };
  }

  async listAssignedWabas(): Promise<readonly ManualMetaWaba[]> {
    return this.wabas;
  }

  async listPhoneNumbers(wabaId: string): Promise<readonly ManualMetaPhoneNumber[]> {
    return this.phones.get(wabaId) ?? [];
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
  add("Phase 11K-M2 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const migrationStatus = await getDatabaseMigrationStatus();
  add("No Phase 11K-M2 migration is pending or required", migrationStatus.applied.includes("0013") && migrationStatus.pending.length === 0);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const key = randomBytes(32).toString("base64");
  const encryption = encryptionService("phase11k_m2", key);
  const setupService = new ManualConnectionSetupService(repository, encryption);
  const transport = new FakeManualMetaTransport();
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

    const setup = await setupService.setup(tenantA, {
      appId: "123456789012345",
      appSecret: "safe_fake_app_secret_phase11k_m2",
      systemUserAccessToken: "safe_fake_system_user_token_phase11k_m2",
    });
    const discover = await assetsService.discover(tenantA, setup.connection.connectionId);
    const discoverPayload = JSON.stringify(discover);
    add("valid System User token succeeds", discover.validation.valid && discover.validation.tokenType === "SYSTEM_USER");
    add("assigned WABAs are returned safely", discover.wabas.length === 2 && discover.wabas[0]?.wabaId === "waba_phase11k_m2_a");
    add("phone numbers are grouped under the correct WABA", discover.wabas[0]?.phoneNumbers.length === 2 && discover.wabas[1]?.phoneNumbers[0]?.phoneNumberId === "phone_phase11k_m2_b1");
    add("multiple WABAs and phones are supported", discoverPayload.includes("Rif WABA") && discoverPayload.includes("phone_phase11k_m2_a2"));
    add("discovery response contains no secrets or sellerId", !/safe_fake|system_user_token|app_secret|seller_phase11k|encrypted|fingerprint|fbtrace/i.test(discoverPayload));
    add("display phone numbers are masked", discover.wabas[0]?.phoneNumbers[0]?.maskedDisplayPhoneNumber === "••••••••0222" && !discoverPayload.includes("+212 600 000 222"));

    const selected = await assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_a", phoneNumberId: "phone_phase11k_m2_a1" });
    add("verified WABA/phone pair persists successfully", selected.connection.status === "VERIFYING" && selected.connection.verifiedName === "Atlas Shop");
    add("selected draft becomes VERIFYING and next step is webhook configuration", selected.nextStep === "CONFIGURE_WEBHOOK");
    add("selection response contains no secret or unmasked phone", !/safe_fake|system_user_token|app_secret|\+212 600 000 222|seller_phase11k/i.test(JSON.stringify(selected)));
    add("existing ACTIVE connection remains unchanged", (await repository.findActiveBySeller(tenantA))?.connectionId === activated?.connectionId);
    add("same selection retry is idempotent", (await assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_a", phoneNumberId: "phone_phase11k_m2_a1" })).connection.connectionId === setup.connection.connectionId);
    add("changed selection while not activated is allowed", (await assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_b", phoneNumberId: "phone_phase11k_m2_b1" })).connection.verifiedName === "Rif Shop");

    add("invalid token fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { valid: false }) === "META_TOKEN_INVALID");
    add("expired token fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { expiresAt: new Date(Date.now() - 1000) }) === "META_TOKEN_EXPIRED");
    add("token App ID mismatch fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { appId: "999999999999999" }) === "META_TOKEN_APP_MISMATCH");
    add("unsupported token type fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { type: "USER" }) === "META_TOKEN_TYPE_UNSUPPORTED");
    add("each missing required scope fails safely", await invalidIssue(setup.connection.connectionId, repository, encryption, { scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] }) === "META_PERMISSION_MISSING" && await invalidIssue(setup.connection.connectionId, repository, encryption, { scopes: ["business_management", "whatsapp_business_messaging"] }) === "META_PERMISSION_MISSING" && await invalidIssue(setup.connection.connectionId, repository, encryption, { scopes: ["business_management", "whatsapp_business_management"] }) === "META_PERMISSION_MISSING");
    add("App Secret/token decryption failure fails closed", await issue(() => new ManualConnectionAssetsService(repository, encryptionService("phase11k_wrong"), transport).discover(tenantA, setup.connection.connectionId)) === "META_APP_CREDENTIALS_INVALID");

    const noWaba = new FakeManualMetaTransport();
    noWaba.wabas = [];
    add("no WABA produces safe issue", await issue(() => new ManualConnectionAssetsService(repository, encryption, noWaba).discover(tenantA, setup.connection.connectionId)) === "META_WABA_ACCESS_MISSING");
    const noPhones = new FakeManualMetaTransport();
    noPhones.phones = new Map(noPhones.wabas.map((waba) => [waba.id, []]));
    add("no phone numbers produces safe issue", await issue(() => new ManualConnectionAssetsService(repository, encryption, noPhones).discover(tenantA, setup.connection.connectionId)) === "META_ASSET_DISCOVERY_FAILED");
    add("pagination rejects untrusted origin", (() => {
      try {
        __phase11kM2ManualMetaTransportTesting.validatePagingOrigin("https://evil.example/page?after=x");
        return false;
      } catch {
        return true;
      }
    })());

    add("phone must belong to selected WABA", await issue(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_a", phoneNumberId: "phone_phase11k_m2_b1" })) === "META_ASSET_DISCOVERY_FAILED");
    add("unlisted WABA is rejected", await issue(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_missing", phoneNumberId: "phone_phase11k_m2_a1" })) === "META_WABA_ACCESS_MISSING");
    add("unlisted phone is rejected", await issue(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_a", phoneNumberId: "phone_missing" })) === "META_ASSET_DISCOVERY_FAILED");

    const other = await repository.createCandidate(tenantB);
    await repository.persistVerifiedMetadata(tenantB, other.connectionId, { phoneNumberId: "phone_phase11k_m2_a2" });
    await repository.updateLifecycleStatus(tenantB, other.connectionId, "VERIFYING");
    add("duplicate phone owned by another seller is rejected safely", await expectsConflict(() => assetsService.selectAssets(tenantA, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_a", phoneNumberId: "phone_phase11k_m2_a2" })));
    add("another seller cannot discover or select", await issue(() => assetsService.discover(tenantB, setup.connection.connectionId)) === "META_APP_CREDENTIALS_INVALID" && await issue(() => assetsService.selectAssets(tenantB, setup.connection.connectionId, { wabaId: "waba_phase11k_m2_a", phoneNumberId: "phone_phase11k_m2_a1" })) === "META_APP_CREDENTIALS_INVALID");
    add("strict bodies reject unknown fields and sellerId", await controllerRejects("discoverManualAssets", { sellerId: sellerA }) && await controllerRejects("selectManualAssets", { wabaId: "1", phoneNumberId: "2", sellerId: sellerA }) && await controllerRejects("selectManualAssets", { wabaId: "1", phoneNumberId: "2", extra: true }));
    add("AGENT/VIEWER cannot use endpoints while OWNER/ADMIN can", !roleHasPermission("AGENT", "whatsapp_connection.manage") && !roleHasPermission("VIEWER", "whatsapp_connection.manage") && roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage"));
    add("current-status remains secret-free", !/safe_fake|encrypted|fingerprint|system_user|app_secret/i.test(JSON.stringify(await new WhatsAppConnectionCurrentService(repository).getCurrent(tenantA))));
  } finally {
    await cleanup();
    const remainingConnections = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("Only Phase 11K-M2 test rows are cleaned up", remainingConnections.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
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
