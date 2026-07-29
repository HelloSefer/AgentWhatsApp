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
  withTransaction,
  type DatabaseTransactionExecutor,
} from "../../../infrastructure/database";
import { roleHasPermission } from "../../auth";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import { MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES } from "../application/manual-system-user-token-validation";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import {
  recordWhatsAppConnectionAudit,
  setWhatsAppConnectionOperationalRecorderForTesting,
} from "../application/whatsapp-connection-operational-events";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import { WhatsAppConnectionMetaTransportError } from "../domain/whatsapp-connection.errors";
import {
  normalizeManualMetaAppSecret,
  normalizeManualSystemUserAccessToken,
} from "../domain/whatsapp-connection.validation";
import type { ManualMetaAppTransport, ManualMetaPhoneNumber, ManualMetaTokenInspectionResult, ManualMetaWaba } from "../infrastructure/meta/manual-meta-app.transport";
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
  encrypted_access_token: string | null;
  token_key_version: string | null;
  token_fingerprint: string | null;
  token_expires_at: Date | null;
  meta_business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  last_verified_at: Date | null;
  encrypted_registration_pin: string | null;
  registration_pin_key_version: string | null;
  registration_pin_fingerprint: string | null;
  phone_registration_completed_at: Date | null;
  waba_subscription_completed_at: Date | null;
  finalization_last_error_code: string | null;
  finalization_last_error_at: Date | null;
  connected_at: Date | null;
  disconnected_at: Date | null;
  replaced_connection_id: string | null;
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

class FakeManualMetaTransport implements ManualMetaAppTransport {
  valid = true;
  type = "SYSTEM_USER";
  scopes: readonly string[] = MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES;
  expiresAt: Date | null = new Date(Date.now() + 86_400_000);
  reportedAppId: string | null = null;
  systemUserId: string | null = "system_user_phase11k_m1";
  failure: WhatsAppConnectionMetaTransportError | null = null;
  inspections = 0;

  async inspectSystemUserToken(appId: string): Promise<ManualMetaTokenInspectionResult> {
    this.inspections += 1;
    if (this.failure) throw this.failure;
    return {
      valid: this.valid,
      appId: this.reportedAppId ?? appId,
      type: this.type,
      scopes: this.scopes,
      expiresAt: this.expiresAt,
      systemUserId: this.systemUserId,
    };
  }

  async listAssignedWabas(): Promise<readonly ManualMetaWaba[]> {
    return [];
  }

  async listPhoneNumbers(): Promise<readonly ManualMetaPhoneNumber[]> {
    return [];
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

async function readRawManualRow(sellerId: string, connectionId: string): Promise<RawManualRow | undefined> {
  const result = await executeDatabaseQuery<RawManualRow>({
    text: `
      SELECT connection_method, status, meta_app_id, public_webhook_id, encrypted_meta_app_secret, meta_app_secret_key_version,
             encrypted_system_user_access_token, system_user_access_token_key_version, encrypted_webhook_verify_token, webhook_verify_token_key_version,
             encrypted_access_token, token_key_version, token_fingerprint, token_expires_at,
             meta_business_id, waba_id, phone_number_id, display_phone_number, verified_name, last_verified_at,
             encrypted_registration_pin, registration_pin_key_version, registration_pin_fingerprint,
             phone_registration_completed_at, waba_subscription_completed_at, finalization_last_error_code, finalization_last_error_at,
             connected_at, disconnected_at, replaced_connection_id
      FROM whatsapp_connections
      WHERE seller_id = $1 AND connection_id = $2
      LIMIT 1
    `,
    values: [sellerId, connectionId],
  });
  return result.rows[0];
}

async function expectsError(callback: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch {
    return true;
  }
}

async function manualSetupResponse(
  service: ManualConnectionSetupService,
  tenant = createTenantContext("seller_phase11k_manual_error"),
  body: Record<string, unknown> = {
    appId: "123456789012345",
    appSecret: "safe_fake_controller_app_secret",
    systemUserAccessToken: "safe_fake_controller_system_user_token",
  },
): Promise<Partial<Response> & { statusCode?: number; body?: unknown }> {
  const controller = new WhatsAppConnectionController({} as never, undefined, undefined, undefined, service);
  const res = responseProbe();
  await controller.setupManualConnection({ body, tenant } as unknown as Request, res as Response);
  return res;
}

async function manualCredentialReplacementResponse(
  service: ManualConnectionSetupService,
  tenant: ReturnType<typeof createTenantContext>,
  connectionId: string,
  body: Record<string, unknown>,
): Promise<Partial<Response> & { statusCode?: number; body?: unknown }> {
  const controller = new WhatsAppConnectionController({} as never, undefined, undefined, undefined, service);
  const res = responseProbe();
  await controller.replaceManualCredentials({
    body,
    params: { connectionId },
    tenant,
  } as unknown as Request, res as Response);
  return res;
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
  const transport = new FakeManualMetaTransport();
  const setupService = new ManualConnectionSetupService(repository, encryption, transport);
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

    const formattingInspectionsBefore = transport.inspections;
    const malformedCredentialResponses = await Promise.all([
      manualSetupResponse(setupService, tenantA, { appId, appSecret: `"${appSecret}"`, systemUserAccessToken }),
      manualSetupResponse(setupService, tenantA, { appId, appSecret: `${appSecret}\n`, systemUserAccessToken }),
      manualSetupResponse(setupService, tenantA, { appId, appSecret, systemUserAccessToken: ` ${systemUserAccessToken}` }),
      manualSetupResponse(setupService, tenantA, { appId, appSecret, systemUserAccessToken: `"${systemUserAccessToken}"` }),
      manualSetupResponse(setupService, tenantA, { appId, appSecret, systemUserAccessToken: `${systemUserAccessToken}\n` }),
    ]);
    add("quoted, whitespace-padded, or multiline credential formats fail before Meta", malformedCredentialResponses.every((response) => response.statusCode === 400) && transport.inspections === formattingInspectionsBefore);
    add("App Secret edge spacing is trimmed without mutating valid internal characters", normalizeManualMetaAppSecret("  internal|secret value  ") === "internal|secret value");
    add("valid System User token punctuation is preserved exactly", normalizeManualSystemUserAccessToken("EA-valid_token+value=/") === "EA-valid_token+value=/");

    const rawRow = await readRawManualRow(sellerA, setup.connection.connectionId);
    const stored = await repository.findManualCredentialStorage(tenantA, setup.connection.connectionId);
    add("manual non-secret metadata persists safely", rawRow?.connection_method === "CUSTOMER_OWNED_META_APP" && rawRow.status === "PENDING" && rawRow.meta_app_id === appId);
    add("App Secret and System User Token are encrypted before persistence", rawRow !== undefined && Boolean(rawRow.encrypted_meta_app_secret) && Boolean(rawRow.encrypted_system_user_access_token) && rawRow.encrypted_meta_app_secret !== appSecret && rawRow.encrypted_system_user_access_token !== systemUserAccessToken);
    add("plaintext manual secrets are never stored", !JSON.stringify(rawRow).includes(appSecret) && !JSON.stringify(rawRow).includes(systemUserAccessToken) && !JSON.stringify(rawRow).includes(setup.webhookSetup.verifyToken));
    add("server generates and encrypts webhook Verify Token", Boolean(rawRow?.encrypted_webhook_verify_token) && stored !== null && encryption.decryptManualWebhookVerifyToken(stored.encryptedWebhookVerifyToken) === setup.webhookSetup.verifyToken);
    add("manual credential key versions persist without fingerprints", rawRow?.meta_app_secret_key_version === "phase11k_m1" && rawRow.system_user_access_token_key_version === "phase11k_m1" && rawRow.webhook_verify_token_key_version === "phase11k_m1");

    const rejectedCredentialAppId = "991122334455667";
    transport.reportedAppId = "991122334455668";
    const appMismatchResponse = await manualSetupResponse(setupService, tenantA, {
      appId: rejectedCredentialAppId,
      appSecret,
      systemUserAccessToken,
    });
    transport.reportedAppId = null;
    transport.type = "USER";
    transport.systemUserId = null;
    const tokenTypeResponse = await manualSetupResponse(setupService, tenantA, {
      appId: rejectedCredentialAppId,
      appSecret,
      systemUserAccessToken,
    });
    transport.type = "SYSTEM_USER";
    transport.systemUserId = "system_user_phase11k_m1";
    transport.scopes = ["whatsapp_business_management"];
    const permissionResponse = await manualSetupResponse(setupService, tenantA, {
      appId: rejectedCredentialAppId,
      appSecret,
      systemUserAccessToken,
    });
    transport.scopes = MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES;
    transport.expiresAt = new Date(Date.now() - 60_000);
    const expiredResponse = await manualSetupResponse(setupService, tenantA, {
      appId: rejectedCredentialAppId,
      appSecret,
      systemUserAccessToken,
    });
    transport.expiresAt = new Date(Date.now() + 86_400_000);
    add("setup enforces app relationship, System User type, token expiry, and both WhatsApp scopes", JSON.stringify(appMismatchResponse.body).includes("META_APP_CREDENTIAL_MISMATCH") && JSON.stringify(tokenTypeResponse.body).includes("META_TOKEN_TYPE_INVALID") && JSON.stringify(permissionResponse.body).includes("META_REQUIRED_PERMISSION_MISSING") && JSON.stringify(expiredResponse.body).includes("META_TOKEN_EXPIRED"));
    transport.expiresAt = null;
    const nonExpiringSetup = await setupService.setup(tenantA, {
      appId: "991122334455669",
      appSecret,
      systemUserAccessToken,
    });
    transport.expiresAt = new Date(Date.now() + 86_400_000);
    add("non-expiring System User tokens are accepted explicitly", nonExpiringSetup.connection.status === "PENDING");
    add("failed credential verification never creates or mutates a draft", await repository.findReusableManualDraft(tenantA, rejectedCredentialAppId) === null);

    const rollbackAppId = "111222333444555";
    const rollbackSetupService = new ManualConnectionSetupService(repository, encryption, transport, async (callback) => {
      await withTransaction(async (transaction) => {
        await callback(transaction);
        throw new Error("phase11k_m1_forced_commit_failure");
      });
      throw new Error("phase11k_m1_transaction_runner_returned_after_failure");
    });
    const rollbackFailed = await expectsError(() => rollbackSetupService.setup(tenantA, {
      appId: rollbackAppId,
      appSecret,
      systemUserAccessToken,
    }));
    const rolledBackDraft = await repository.findReusableManualDraft(tenantA, rollbackAppId);
    add("transaction failure rolls back the manual draft and all credentials", rollbackFailed && rolledBackDraft === null);

    const publicRead = await repository.findByConnectionId(tenantA, setup.connection.connectionId);
    const current = await currentService.getCurrent(tenantA);
    const publicPayload = JSON.stringify({ publicRead, current });
    add("current-status and ordinary reads never return Verify Token or manual secrets", !publicPayload.includes(setup.webhookSetup.verifyToken) && !publicPayload.includes(appSecret) && !publicPayload.includes(systemUserAccessToken));
    add("ordinary reads never return encrypted values, fingerprints, or key versions", !/encrypted|fingerprint|keyVersion|VerifyToken|AccessToken|AppSecret/u.test(publicPayload));

    const storageBeforeInvalidRetry = await repository.findManualCredentialStorage(tenantA, setup.connection.connectionId);
    transport.valid = false;
    const invalidRetryResponse = await manualSetupResponse(setupService, tenantA, {
      appId,
      appSecret: `${appSecret}_invalid_retry`,
      systemUserAccessToken: `${systemUserAccessToken}_invalid_retry`,
    });
    transport.valid = true;
    const storageAfterInvalidRetry = await repository.findManualCredentialStorage(tenantA, setup.connection.connectionId);
    add("invalid token cannot produce credentials-verified setup success", invalidRetryResponse.statusCode === 400 && JSON.stringify(invalidRetryResponse.body) === JSON.stringify({
      message: "WhatsApp connection could not be validated.",
      issueCode: "META_TOKEN_INVALID",
    }));
    add("existing draft cannot bypass submitted credential validation", storageBeforeInvalidRetry?.encryptedSystemUserAccessToken === storageAfterInvalidRetry?.encryptedSystemUserAccessToken);

    const replacementAppSecret = `${appSecret}_rotated`;
    const replacementAccessToken = `${systemUserAccessToken}_rotated`;
    const inspectionsBeforeRetry = transport.inspections;
    const retry = await setupService.setup(tenantA, {
      appId,
      appSecret: replacementAppSecret,
      systemUserAccessToken: replacementAccessToken,
    });
    const retryStorage = await repository.findManualCredentialStorage(tenantA, retry.connection.connectionId);
    add("same seller retry reuses a safe existing draft", retry.connection.connectionId === setup.connection.connectionId && retry.webhookSetup.verifyToken !== setup.webhookSetup.verifyToken);
    add("every setup retry performs real submitted credential inspection", transport.inspections === inspectionsBeforeRetry + 1);
    add("same-draft retry atomically stores only the newest encrypted credentials", retryStorage !== null && encryption.decryptManualMetaAppSecret(retryStorage.encryptedMetaAppSecret) === replacementAppSecret && encryption.decryptManualSystemUserAccessToken(retryStorage.encryptedSystemUserAccessToken) === replacementAccessToken && encryption.decryptManualSystemUserAccessToken(retryStorage.encryptedSystemUserAccessToken) !== systemUserAccessToken);

    await repository.persistAccessTokenCredential(tenantA, retry.connection.connectionId, encryption.encryptAccessToken("safe_fake_stale_generic_token"));
    await repository.persistVerifiedMetadata(tenantA, retry.connection.connectionId, {
      metaBusinessId: "772345678901230",
      wabaId: "772345678901231",
      phoneNumberId: "772345678901232",
      displayPhoneNumber: "+212 600 000 333",
      verifiedName: "Stale verified name",
    });
    await repository.persistRegistrationPinCredential(tenantA, retry.connection.connectionId, encryption.encryptRegistrationPin("123456"));
    await repository.persistFinalizationProgress(tenantA, retry.connection.connectionId, {
      phoneRegistrationCompletedAt: new Date(),
      wabaSubscriptionCompletedAt: new Date(),
      finalizationLastErrorCode: "meta_permission_denied",
    });
    await repository.updateLifecycleStatus(tenantA, retry.connection.connectionId, "VERIFYING");
    const replacementPending = await repository.markReplacementPending(tenantA, retry.connection.connectionId, active.connectionId);
    const publicWebhookIdBeforeReplacement = (await readRawManualRow(sellerA, retry.connection.connectionId))?.public_webhook_id;
    const latestAppSecret = `${appSecret}_latest`;
    const latestAccessToken = `${systemUserAccessToken}_latest`;
    const replaceResponse = await manualCredentialReplacementResponse(setupService, tenantA, retry.connection.connectionId, {
      appId,
      appSecret: latestAppSecret,
      systemUserAccessToken: latestAccessToken,
    });
    const resetRow = await readRawManualRow(sellerA, retry.connection.connectionId);
    const resetStorage = await repository.findManualCredentialStorage(tenantA, retry.connection.connectionId);
    add("dedicated credential replacement returns only verified PENDING state", replaceResponse.statusCode === 200 && (replaceResponse.body as { connection?: { status?: string } }).connection?.status === "PENDING" && !JSON.stringify(replaceResponse.body).includes(latestAppSecret) && !JSON.stringify(replaceResponse.body).includes(latestAccessToken));
    add("credential replacement stores and exposes the newest token to subsequent backend reads", resetStorage !== null && encryption.decryptManualSystemUserAccessToken(resetStorage.encryptedSystemUserAccessToken) === latestAccessToken && encryption.decryptManualMetaAppSecret(resetStorage.encryptedMetaAppSecret) === latestAppSecret);
    add("credential replacement clears stale asset, verification, finalization, generic-token, and PIN state atomically", resetRow?.status === "PENDING" && resetRow.meta_business_id === null && resetRow.waba_id === null && resetRow.phone_number_id === null && resetRow.display_phone_number === null && resetRow.verified_name === null && resetRow.last_verified_at === null && resetRow.encrypted_access_token === null && resetRow.token_key_version === null && resetRow.token_fingerprint === null && resetRow.token_expires_at === null && resetRow.encrypted_registration_pin === null && resetRow.registration_pin_key_version === null && resetRow.registration_pin_fingerprint === null && resetRow.phone_registration_completed_at === null && resetRow.waba_subscription_completed_at === null && resetRow.finalization_last_error_code === null && resetRow.finalization_last_error_at === null);
    add("credential replacement preserves webhook identity and replacement linkage", replacementPending?.replacedConnectionId === active.connectionId && resetRow !== undefined && resetRow.public_webhook_id === publicWebhookIdBeforeReplacement && resetRow.replaced_connection_id === active.connectionId);

    const secondDraft = await setupService.setup(tenantA, { appId: "987654321098765", appSecret, systemUserAccessToken });
    const publicIdA = rawRow?.public_webhook_id ?? "";
    const publicIdB = secondDraft.webhookSetup.callbackPath.split("/").pop() ?? "";
    add("public webhook ID is opaque, unique, and not sellerId", Boolean(publicIdA) && publicIdA !== publicIdB && publicIdA !== sellerA && !publicIdA.includes(sellerA) && !/881234567890123/u.test(publicIdA));

    const activeManual = await setupService.setup(tenantB, {
      appId: "333444555666777",
      appSecret,
      systemUserAccessToken,
    });
    await repository.updateLifecycleStatus(tenantB, activeManual.connection.connectionId, "ACTIVE");
    const activeManualStorageBefore = await repository.findManualCredentialStorage(tenantB, activeManual.connection.connectionId);
    const inspectionsBeforeActiveReplacement = transport.inspections;
    const activeReplacementResponse = await manualCredentialReplacementResponse(setupService, tenantB, activeManual.connection.connectionId, {
      appId: "333444555666777",
      appSecret: `${appSecret}_active_replacement`,
      systemUserAccessToken: `${systemUserAccessToken}_active_replacement`,
    });
    const activeRepositoryReplacement = activeManualStorageBefore
      ? await repository.replaceManualCredentialsAndResetState(tenantB, activeManual.connection.connectionId, {
          metaAppId: "333444555666777",
          encryptedMetaAppSecret: activeManualStorageBefore.encryptedMetaAppSecret,
          metaAppSecretKeyVersion: activeManualStorageBefore.metaAppSecretKeyVersion,
          encryptedSystemUserAccessToken: activeManualStorageBefore.encryptedSystemUserAccessToken,
          systemUserAccessTokenKeyVersion: activeManualStorageBefore.systemUserAccessTokenKeyVersion,
          encryptedWebhookVerifyToken: activeManualStorageBefore.encryptedWebhookVerifyToken,
          webhookVerifyTokenKeyVersion: activeManualStorageBefore.webhookVerifyTokenKeyVersion,
        })
      : undefined;
    const activeManualStorageAfter = await repository.findManualCredentialStorage(tenantB, activeManual.connection.connectionId);
    add("ACTIVE manual connection credentials return the dedicated 409 issue without Meta or persistence", activeReplacementResponse.statusCode === 409 && JSON.stringify(activeReplacementResponse.body) === JSON.stringify({
      message: "Active WhatsApp connection credentials cannot be replaced.",
      issueCode: "MANUAL_CONNECTION_CREDENTIAL_REPLACEMENT_FORBIDDEN",
    }) && transport.inspections === inspectionsBeforeActiveReplacement && activeRepositoryReplacement === null && activeManualStorageBefore?.encryptedSystemUserAccessToken === activeManualStorageAfter?.encryptedSystemUserAccessToken && (await repository.findByConnectionId(tenantB, activeManual.connection.connectionId))?.status === "ACTIVE");

    const inspectionsBeforeUnknownReplacementBody = transport.inspections;
    const unknownReplacementBody = await manualCredentialReplacementResponse(setupService, tenantA, retry.connection.connectionId, {
      appId,
      appSecret,
      systemUserAccessToken,
      sellerId: sellerA,
    });
    add("credential replacement rejects unknown browser fields before Meta or persistence", unknownReplacementBody.statusCode === 400 && transport.inspections === inspectionsBeforeUnknownReplacementBody);

    add("another seller cannot read or update the draft", await repository.findByConnectionId(tenantB, setup.connection.connectionId) === null && await repository.persistManualCredentials(tenantB, setup.connection.connectionId, {
      encryptedMetaAppSecret: rawRow?.encrypted_meta_app_secret ?? "encrypted",
      metaAppSecretKeyVersion: rawRow?.meta_app_secret_key_version ?? "v",
      encryptedSystemUserAccessToken: rawRow?.encrypted_system_user_access_token ?? "encrypted",
      systemUserAccessTokenKeyVersion: rawRow?.system_user_access_token_key_version ?? "v",
      encryptedWebhookVerifyToken: rawRow?.encrypted_webhook_verify_token ?? "encrypted",
      webhookVerifyTokenKeyVersion: rawRow?.webhook_verify_token_key_version ?? "v",
    }) === null);
    add("another seller cannot invoke the atomic credential replacement", resetStorage !== null && await repository.replaceManualCredentialsAndResetState(tenantB, setup.connection.connectionId, {
      metaAppId: appId,
      encryptedMetaAppSecret: resetStorage.encryptedMetaAppSecret,
      metaAppSecretKeyVersion: resetStorage.metaAppSecretKeyVersion,
      encryptedSystemUserAccessToken: resetStorage.encryptedSystemUserAccessToken,
      systemUserAccessTokenKeyVersion: resetStorage.systemUserAccessTokenKeyVersion,
      encryptedWebhookVerifyToken: resetStorage.encryptedWebhookVerifyToken,
      webhookVerifyTokenKeyVersion: resetStorage.webhookVerifyTokenKeyVersion,
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

    const capturedEvents: unknown[] = [];
    setWhatsAppConnectionOperationalRecorderForTesting({
      recordAudit: (eventName, payload) => capturedEvents.push({ eventName, payload }),
      increment: () => undefined,
      observe: () => undefined,
    });
    try {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_setup_failed", {
        sellerId: sellerA,
        connectionMethod: "CUSTOMER_OWNED_META_APP",
        operationStage: "input_validation",
        errorCode: "MANUAL_CONNECTION_SETUP_FAILED",
        draftMode: "unknown",
        reason: "invalid_request",
      });
      const sanitizedSellerEventText = JSON.stringify(capturedEvents.at(-1));
      add("central operational logging drops sellerId from safe payloads", !sanitizedSellerEventText.includes(sellerA) && !sanitizedSellerEventText.includes("sellerId"));

      const unavailableResponse = await manualSetupResponse(new ManualConnectionSetupService({} as ManualWhatsAppConnectionRepository, null, transport));
      const unavailableEvent = capturedEvents.at(-1);
      add("missing encryption configuration fails closed with a bounded safe 500", unavailableResponse.statusCode === 500 && JSON.stringify(unavailableResponse.body) === JSON.stringify({ message: "WhatsApp connection service unavailable.", issueCode: "WHATSAPP_CREDENTIAL_ENCRYPTION_UNAVAILABLE" }) && JSON.stringify(unavailableEvent).includes("encryption_service_initialization"));
      add("missing and malformed encryption configuration are rejected before persistence", await expectsError(() => validateWhatsAppConnectionCredentialEncryptionConfiguration({})) && await expectsError(() => validateWhatsAppConnectionCredentialEncryptionConfiguration({
        activeKeyVersion: "phase11k_m1",
        keysJson: JSON.stringify({ phase11k_m1: "not-a-valid-aes-256-key" }),
      })));

      const diagnosticTransport = new FakeManualMetaTransport();
      diagnosticTransport.failure = new WhatsAppConnectionMetaTransportError("auth", {
        operation: "inspect_system_user_token",
        httpStatus: 401,
        metaErrorCode: 190,
        metaErrorSubcode: 467,
      });
      const diagnosticAppSecret = "safe_fake_diagnostic_app_secret_marker";
      const diagnosticAccessToken = "safe_fake_diagnostic_access_token_marker";
      const diagnosticResponse = await manualSetupResponse(
        new ManualConnectionSetupService(repository, encryption, diagnosticTransport),
        tenantA,
        {
          appId,
          appSecret: diagnosticAppSecret,
          systemUserAccessToken: diagnosticAccessToken,
        },
      );
      const diagnosticEvent = capturedEvents.find((entry) =>
        (entry as { eventName?: string }).eventName === "whatsapp_connection.manual_meta_graph_failed"
      );
      const diagnosticEventText = JSON.stringify(diagnosticEvent);
      add("debug-token caller authentication failure maps to the acquired App access token", diagnosticResponse.statusCode === 400 && diagnosticEventText.includes("\"metaOperation\":\"inspect_system_user_token\"") && diagnosticEventText.includes("\"httpStatus\":401") && diagnosticEventText.includes("\"metaErrorCode\":190") && diagnosticEventText.includes("\"metaErrorSubcode\":467") && diagnosticEventText.includes("\"issueCode\":\"META_APP_ACCESS_TOKEN_INVALID\""));
      add("setup Graph diagnostics exclude credentials, request URLs, fields, raw payloads, and trace data", !diagnosticEventText.includes(diagnosticAppSecret) && !diagnosticEventText.includes(diagnosticAccessToken) && !/appSecret|systemUserAccessToken|client_secret|oauth\/access_token|Authorization|fbtrace|raw_graph/iu.test(diagnosticEventText));

      const appSecretFailureTransport = new FakeManualMetaTransport();
      appSecretFailureTransport.failure = new WhatsAppConnectionMetaTransportError("validation", {
        operation: "acquire_app_access_token",
        httpStatus: 400,
        metaErrorCode: 190,
        metaErrorSubcode: 123,
      });
      const appSecretFailureResponse = await manualSetupResponse(
        new ManualConnectionSetupService(repository, encryption, appSecretFailureTransport),
        tenantA,
        {
          appId,
          appSecret: diagnosticAppSecret,
          systemUserAccessToken: diagnosticAccessToken,
        },
      );
      const appSecretDiagnostic = capturedEvents.find((entry) => {
        const payload = (entry as { payload?: { metaOperation?: string } }).payload;
        return payload?.metaOperation === "acquire_app_access_token";
      });
      const appSecretDiagnosticText = JSON.stringify(appSecretDiagnostic);
      add("App credential acquisition failure maps separately from the input System User token", appSecretFailureResponse.statusCode === 400 && JSON.stringify(appSecretFailureResponse.body).includes("META_APP_SECRET_INVALID") && appSecretDiagnosticText.includes("\"metaErrorSubcode\":123") && !appSecretDiagnosticText.includes(diagnosticAppSecret) && !appSecretDiagnosticText.includes(diagnosticAccessToken) && !/client_secret|oauth\/access_token|Authorization|fbtrace/iu.test(appSecretDiagnosticText));

      const repositoryFailure = new ManualConnectionSetupService({
        findReusableManualDraft: async () => {
          throw new Error("phase11k_m1_repository_failure_safe");
        },
      } as unknown as ManualWhatsAppConnectionRepository, encryption, transport, async (callback) => callback({} as DatabaseTransactionExecutor));
      const eventCountBeforeRepositoryFailure = capturedEvents.length;
      const repositoryFailureResponse = await manualSetupResponse(repositoryFailure);
      const repositoryFailureEvents = capturedEvents.slice(eventCountBeforeRepositoryFailure);
      const eventText = JSON.stringify(capturedEvents);
      add("repository failure returns the generic safe 500 with exactly one safe event", repositoryFailureResponse.statusCode === 500 && JSON.stringify(repositoryFailureResponse.body) === JSON.stringify({ message: "WhatsApp connection service unavailable." }) && repositoryFailureEvents.length === 1 && JSON.stringify(repositoryFailureEvents[0]).includes("existing_draft_lookup"));
      add("manual setup failure diagnostics never contain credentials or request body", !eventText.includes("safe_fake_controller_app_secret") && !eventText.includes("safe_fake_controller_system_user_token") && !/appSecret|systemUserAccessToken|verifyToken|appId/u.test(eventText));
    } finally {
      setWhatsAppConnectionOperationalRecorderForTesting(undefined);
    }

    add("manual setup validates every accepted submission before encryption or persistence", transport.inspections >= 6);
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
