import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { roleHasPermission } from "../../auth";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import { PostgreSqlWhatsAppConnectionRepository } from "../infrastructure/postgresql/postgresql-whatsapp-connection.repository";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;
type RawManualRow = Readonly<{
  connection_method: string;
  status: string;
  meta_app_id: string | null;
  public_webhook_id: string | null;
  encrypted_meta_app_secret: string | null;
  meta_app_secret_key_version: string | null;
  encrypted_system_user_access_token: string | null;
  system_user_access_token_key_version: string | null;
  encrypted_webhook_verify_token: string | null;
  webhook_verify_token_key_version: string | null;
}>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function encodedKey(): string {
  return randomBytes(32).toString("base64");
}

function encryptionService(): WhatsAppConnectionCredentialEncryptionService {
  const key = encodedKey();
  return new WhatsAppConnectionCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: "phase11k_m1",
    keysJson: JSON.stringify({ phase11k_m1: key }),
  }));
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

async function expectsError(callback: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11K-M1 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const firstMigrationRun = await runDatabaseMigrations();
  const secondMigrationRun = await runDatabaseMigrations();
  const migrationStatus = await getDatabaseMigrationStatus();
  add("Manual connection migration 0013 is applied explicitly", migrationStatus.applied.includes("0013") && !migrationStatus.pending.includes("0013"));
  add("Migration runner remains idempotent after Phase 11K-M1 registration", Array.isArray(firstMigrationRun.applied) && secondMigrationRun.applied.length === 0);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const encryption = encryptionService();
  const setupService = new ManualConnectionSetupService(repository, encryption);
  const currentService = new WhatsAppConnectionCurrentService(repository);

  const sellerA = uniqueId("seller_phase11k_m1");
  const sellerB = uniqueId("seller_phase11k_m1");
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);
  const appId = "123456789012345";
  const appSecret = `safe_fake_app_secret_${randomUUID().replace(/-/gu, "")}`;
  const systemUserAccessToken = `safe_fake_system_user_token_${randomUUID().replace(/-/gu, "")}`;

  try {
    await createSeller(sellerService, sellerA);
    await createSeller(sellerService, sellerB);

    const active = await repository.createCandidate(tenantA);
    await repository.persistVerifiedMetadata(tenantA, active.connectionId, { phoneNumberId: "881234567890123", displayPhoneNumber: "+212 600 000 111" });
    const activated = await repository.updateLifecycleStatus(tenantA, active.connectionId, "ACTIVE");

    const setup = await setupService.setup(tenantA, { appId, appSecret, systemUserAccessToken });
    add("manual draft creation succeeds for authenticated trusted seller", setup.connection.status === "PENDING" && setup.connection.appId === appId);
    add("connection method is CUSTOMER_OWNED_META_APP", setup.connection.connectionMethod === "CUSTOMER_OWNED_META_APP");
    add("existing ACTIVE connection remains untouched", (await repository.findActiveBySeller(tenantA))?.connectionId === activated?.connectionId);
    add("setup response includes safe callback path and one-time verify token", setup.webhookSetup.callbackPath.startsWith("/api/whatsapp/webhooks/connections/") && Boolean(setup.webhookSetup.verifyToken) && !setup.webhookSetup.callbackPath.includes(sellerA));

    const raw = await executeDatabaseQuery<RawManualRow>({
      text: `
        SELECT connection_method, status, meta_app_id, public_webhook_id, encrypted_meta_app_secret, meta_app_secret_key_version,
               encrypted_system_user_access_token, system_user_access_token_key_version, encrypted_webhook_verify_token, webhook_verify_token_key_version
        FROM whatsapp_connections
        WHERE seller_id = $1 AND connection_id = $2
        LIMIT 1
      `,
      values: [sellerA, setup.connection.connectionId],
    });
    const rawRow = raw.rows[0];
    const stored = await repository.findManualCredentialStorage(tenantA, setup.connection.connectionId);
    add("manual non-secret metadata persists safely", rawRow?.connection_method === "CUSTOMER_OWNED_META_APP" && rawRow.status === "PENDING" && rawRow.meta_app_id === appId);
    add("App Secret and System User Token are encrypted before persistence", Boolean(rawRow?.encrypted_meta_app_secret) && Boolean(rawRow?.encrypted_system_user_access_token) && rawRow?.encrypted_meta_app_secret !== appSecret && rawRow.encrypted_system_user_access_token !== systemUserAccessToken);
    add("plaintext manual secrets are never stored", !JSON.stringify(rawRow).includes(appSecret) && !JSON.stringify(rawRow).includes(systemUserAccessToken) && !JSON.stringify(rawRow).includes(setup.webhookSetup.verifyToken));
    add("server generates and encrypts webhook Verify Token", Boolean(rawRow?.encrypted_webhook_verify_token) && stored !== null && encryption.decryptManualWebhookVerifyToken(stored.encryptedWebhookVerifyToken) === setup.webhookSetup.verifyToken);
    add("manual credential key versions persist without fingerprints", rawRow?.meta_app_secret_key_version === "phase11k_m1" && rawRow.system_user_access_token_key_version === "phase11k_m1" && rawRow.webhook_verify_token_key_version === "phase11k_m1");

    const publicRead = await repository.findByConnectionId(tenantA, setup.connection.connectionId);
    const current = await currentService.getCurrent(tenantA);
    const publicPayload = JSON.stringify({ publicRead, current });
    add("current-status and ordinary reads never return Verify Token or manual secrets", !publicPayload.includes(setup.webhookSetup.verifyToken) && !publicPayload.includes(appSecret) && !publicPayload.includes(systemUserAccessToken));
    add("ordinary reads never return encrypted values, fingerprints, or key versions", !/encrypted|fingerprint|keyVersion|VerifyToken|AccessToken|AppSecret/u.test(publicPayload));

    const retry = await setupService.setup(tenantA, { appId, appSecret: `${appSecret}_rotated`, systemUserAccessToken: `${systemUserAccessToken}_rotated` });
    add("same seller retry reuses a safe existing draft", retry.connection.connectionId === setup.connection.connectionId && retry.webhookSetup.verifyToken !== setup.webhookSetup.verifyToken);

    const secondDraft = await setupService.setup(tenantA, { appId: "987654321098765", appSecret, systemUserAccessToken });
    const publicIdA = rawRow?.public_webhook_id ?? "";
    const publicIdB = secondDraft.webhookSetup.callbackPath.split("/").pop() ?? "";
    add("public webhook ID is opaque, unique, and not sellerId", Boolean(publicIdA) && publicIdA !== publicIdB && publicIdA !== sellerA && !publicIdA.includes(sellerA) && !/881234567890123/u.test(publicIdA));
    add("another seller cannot read or update the draft", await repository.findByConnectionId(tenantB, setup.connection.connectionId) === null && await repository.persistManualCredentials(tenantB, setup.connection.connectionId, {
      encryptedMetaAppSecret: rawRow?.encrypted_meta_app_secret ?? "encrypted",
      metaAppSecretKeyVersion: rawRow?.meta_app_secret_key_version ?? "v",
      encryptedSystemUserAccessToken: rawRow?.encrypted_system_user_access_token ?? "encrypted",
      systemUserAccessTokenKeyVersion: rawRow?.system_user_access_token_key_version ?? "v",
      encryptedWebhookVerifyToken: rawRow?.encrypted_webhook_verify_token ?? "encrypted",
      webhookVerifyTokenKeyVersion: rawRow?.webhook_verify_token_key_version ?? "v",
    }) === null);

    const embedded = await repository.createCandidate(tenantB);
    add("Embedded Signup candidates still default safely to EMBEDDED_SIGNUP", embedded.connectionMethod === "EMBEDDED_SIGNUP");
    const legacyConstraint = await executeDatabaseQuery<{ connection_method: string }>({
      text: "SELECT connection_method FROM whatsapp_connections WHERE seller_id = $1 AND connection_id = $2 LIMIT 1",
      values: [sellerB, embedded.connectionId],
    });
    add("existing rows default safely to EMBEDDED_SIGNUP at persistence layer", legacyConstraint.rows[0]?.connection_method === "EMBEDDED_SIGNUP");

    add("App ID validation rejects non-numeric and blank values", await expectsError(() => setupService.setup(tenantA, { appId: "app_123", appSecret, systemUserAccessToken })) && await expectsError(() => setupService.setup(tenantA, { appId: " ", appSecret, systemUserAccessToken })));
    add("manual setup rejects browser-supplied webhook Verify Token and unknown fields", await controllerRejects({ appId, appSecret, systemUserAccessToken, webhookVerifyToken: "browser_chosen" }) && await controllerRejects({ appId, appSecret, systemUserAccessToken, sellerId: sellerA }));
    add("manual setup rejects WABA, phone, connection, token aliases, status, and method overrides", await controllerRejects({ appId, appSecret, systemUserAccessToken, wabaId: "1" }) && await controllerRejects({ appId, appSecret, systemUserAccessToken, phoneNumberId: "1" }) && await controllerRejects({ appId, appSecret, systemUserAccessToken, connectionId: "1" }) && await controllerRejects({ appId, appSecret, accessToken: systemUserAccessToken }) && await controllerRejects({ appId, appSecret, systemUserAccessToken, status: "ACTIVE" }) && await controllerRejects({ appId, appSecret, systemUserAccessToken, connectionMethod: "EMBEDDED_SIGNUP" }));
    add("OWNER and ADMIN can create while AGENT and VIEWER cannot", roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage") && !roleHasPermission("AGENT", "whatsapp_connection.manage") && !roleHasPermission("VIEWER", "whatsapp_connection.manage"));
    add("database all-present-or-all-absent manual credential constraint is enforced", await expectsError(() => executeDatabaseQuery({
      text: "UPDATE whatsapp_connections SET encrypted_meta_app_secret = $3 WHERE seller_id = $1 AND connection_id = $2",
      values: [sellerB, embedded.connectionId, rawRow?.encrypted_meta_app_secret ?? "encrypted"],
    })));
  } finally {
    await cleanup();
    const remainingConnections = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] })
      : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] })
      : { rows: [{ count: "0" }] };
    add("Only Phase 11K-M1 test rows are cleaned up", remainingConnections.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

async function controllerRejects(body: Record<string, unknown>): Promise<boolean> {
  const controller = new WhatsAppConnectionController({} as never, undefined, undefined, undefined, {
    setup: async () => {
      throw new Error("manual setup should not be reached for invalid body");
    },
  } as never);
  const res = responseProbe();
  await controller.setupManualConnection({ body, tenant: createTenantContext("seller_phase11k_controller") } as unknown as Request, res as Response);
  return res.statusCode === 400;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11K-M1 manual connection foundation test failed safely." })}\n`);
  process.exitCode = 1;
});
