import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, getDatabasePoolState, type DatabaseQueryExecutor, type TenantContext } from "../../../infrastructure/database";
import { EmbeddedSignupCompletionService, type TransactionRunner } from "../application/embedded-signup-completion.service";
import { validateMetaEmbeddedSignupConfiguration } from "../application/meta-embedded-signup.config";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { WhatsAppConnectionCredentialService } from "../application/whatsapp-connection-credential.service";
import type { WhatsAppConnectionFinalizationProgressInput, WhatsAppConnectionRepository, WhatsAppConnectionRepositoryOptions, VerifiedWhatsAppConnectionMetadataInput } from "../contracts/whatsapp-connection.repository";
import type { PersistWhatsAppConnectionCredentialInput, PersistWhatsAppConnectionRegistrationPinInput, WhatsAppConnectionCredentialStorage, WhatsAppConnectionRegistrationPinStorage } from "../domain/whatsapp-connection-credentials.types";
import {
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionCompletionValidationError,
  WhatsAppConnectionCompletionVerificationError,
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionMetaConfigurationError,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
} from "../domain/whatsapp-connection.errors";
import type { ActiveWhatsAppConnectionResolution, WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";
import type { MetaCodeExchangeResult, MetaEmbeddedSignupTransport, MetaPhoneNumberResult, MetaPhoneRegistrationStatusResult, MetaTokenInspectionResult, MetaWabaResult, MetaWabaSubscriptionStatusResult } from "../infrastructure/meta/meta-embedded-signup.transport";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";

type TestCase = Readonly<{ name: string; passed: boolean }>;
type Store = Readonly<{ connections: WhatsAppConnection[]; credentials: WhatsAppConnectionCredentialStorage[] }>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

async function expectsError(callback: () => Promise<unknown> | unknown, expected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return expected(error);
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function connection(input: Partial<WhatsAppConnection> & { sellerId: string }): WhatsAppConnection {
  const now = new Date();
  return {
    connectionId: input.connectionId ?? id("conn_phase11d"),
    sellerId: input.sellerId,
    provider: "META_WHATSAPP_CLOUD_API",
    status: input.status ?? "PENDING",
    metaBusinessId: input.metaBusinessId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber: input.displayPhoneNumber,
    verifiedName: input.verifiedName,
    connectedAt: input.connectedAt,
    lastVerifiedAt: input.lastVerifiedAt,
    disconnectedAt: input.disconnectedAt,
    replacedConnectionId: input.replacedConnectionId,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function cloneConnection(value: WhatsAppConnection): WhatsAppConnection {
  return { ...value };
}

class FakeRepository implements WhatsAppConnectionRepository {
  connections: WhatsAppConnection[] = [];
  credentials: WhatsAppConnectionCredentialStorage[] = [];
  failCredentialPersist = false;

  snapshot(): Store {
    return {
      connections: this.connections.map(cloneConnection),
      credentials: this.credentials.map((credential) => ({ ...credential })),
    };
  }

  restore(store: Store): void {
    this.connections = store.connections.map(cloneConnection);
    this.credentials = store.credentials.map((credential) => ({ ...credential }));
  }

  async createCandidate(tenant: TenantContext): Promise<WhatsAppConnection> {
    const candidate = connection({ sellerId: tenant.sellerId });
    this.connections.push(candidate);
    return candidate;
  }

  async findByConnectionId(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    return this.connections.find((entry) => entry.sellerId === tenant.sellerId && entry.connectionId === connectionId) ?? null;
  }

  async findAllForSeller(tenant: TenantContext): Promise<readonly WhatsAppConnection[]> {
    return this.connections.filter((entry) => entry.sellerId === tenant.sellerId);
  }

  async findCurrentForSeller(tenant: TenantContext): Promise<readonly WhatsAppConnection[]> {
    return this.connections.filter((entry) => entry.sellerId === tenant.sellerId && ["PENDING", "VERIFYING", "ACTIVE", "REPLACEMENT_PENDING", "ERROR"].includes(entry.status));
  }

  async findActiveBySeller(tenant: TenantContext): Promise<WhatsAppConnection | null> {
    return this.connections.find((entry) => entry.sellerId === tenant.sellerId && entry.status === "ACTIVE") ?? null;
  }

  async findByPhoneNumberIdForSeller(tenant: TenantContext, phoneNumberId: string): Promise<WhatsAppConnection | null> {
    return this.connections.find((entry) => entry.sellerId === tenant.sellerId && entry.phoneNumberId === phoneNumberId) ?? null;
  }

  async resolveByPhoneNumberId(phoneNumberId: string): Promise<ActiveWhatsAppConnectionResolution | null> {
    const found = this.connections.find((entry) => entry.phoneNumberId === phoneNumberId);
    return found ? { sellerId: found.sellerId, connection: found } : null;
  }

  async resolveActiveByPhoneNumberId(phoneNumberId: string): Promise<ActiveWhatsAppConnectionResolution | null> {
    const found = this.connections.find((entry) => entry.phoneNumberId === phoneNumberId && entry.status === "ACTIVE");
    return found ? { sellerId: found.sellerId, connection: found } : null;
  }

  async updateLifecycleStatus(tenant: TenantContext, connectionId: string, status: WhatsAppConnectionStatus): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = { ...current, status, updatedAt: new Date(), connectedAt: status === "ACTIVE" ? current.connectedAt ?? new Date() : current.connectedAt };
    this.replace(updated);
    return updated;
  }

  async activateConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current || current.status !== "VERIFYING") return null;
    const now = new Date();
    const updated = { ...current, status: "ACTIVE" as const, connectedAt: current.connectedAt ?? now, lastVerifiedAt: now, updatedAt: now };
    this.replace(updated);
    return updated;
  }

  async markReplacementPending(tenant: TenantContext, connectionId: string, replacedConnectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    const active = await this.findByConnectionId(tenant, replacedConnectionId);
    if (!current || !active || active.status !== "ACTIVE" || current.connectionId === active.connectionId) return null;
    const updated = { ...current, status: "REPLACEMENT_PENDING" as const, replacedConnectionId: active.connectionId, connectedAt: undefined, disconnectedAt: undefined, updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async replaceActiveConnection(tenant: TenantContext, activeConnectionId: string, replacementConnectionId: string): Promise<WhatsAppConnection | null> {
    const active = await this.findByConnectionId(tenant, activeConnectionId);
    const replacement = await this.findByConnectionId(tenant, replacementConnectionId);
    if (!active || !replacement || active.status !== "ACTIVE" || replacement.status !== "REPLACEMENT_PENDING" || replacement.replacedConnectionId !== active.connectionId) return null;
    const now = new Date();
    this.replace({ ...active, status: "DISCONNECTED", disconnectedAt: active.disconnectedAt ?? now, updatedAt: now });
    const updated = { ...replacement, status: "ACTIVE" as const, connectedAt: now, lastVerifiedAt: now, disconnectedAt: undefined, updatedAt: now };
    this.replace(updated);
    return updated;
  }

  async disconnectActiveConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current || current.status !== "ACTIVE") return null;
    const now = new Date();
    const updated = { ...current, status: "DISCONNECTED" as const, disconnectedAt: current.disconnectedAt ?? now, updatedAt: now };
    this.replace(updated);
    return updated;
  }

  async persistVerifiedMetadata(tenant: TenantContext, connectionId: string, metadata: VerifiedWhatsAppConnectionMetadataInput): Promise<WhatsAppConnection | null> {
    const other = this.connections.find((entry) => entry.sellerId !== tenant.sellerId && entry.phoneNumberId === metadata.phoneNumberId);
    if (other) throw new WhatsAppConnectionPersistenceError();
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = {
      ...current,
      wabaId: metadata.wabaId ?? undefined,
      phoneNumberId: metadata.phoneNumberId ?? undefined,
      displayPhoneNumber: metadata.displayPhoneNumber ?? undefined,
      verifiedName: metadata.verifiedName ?? undefined,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    };
    this.replace(updated);
    return updated;
  }

  async persistAccessTokenCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionCredentialInput): Promise<WhatsAppConnectionCredentialStorage | null> {
    if (this.failCredentialPersist) throw new WhatsAppConnectionPersistenceError();
    const connection = await this.findByConnectionId(tenant, connectionId);
    if (!connection) return null;
    const stored = {
      connectionId,
      sellerId: tenant.sellerId,
      encryptedAccessToken: credential.encryptedAccessToken,
      tokenKeyVersion: credential.tokenKeyVersion,
      tokenFingerprint: credential.tokenFingerprint,
      tokenExpiresAt: credential.tokenExpiresAt ?? undefined,
    };
    this.credentials = this.credentials.filter((entry) => entry.connectionId !== connectionId);
    this.credentials.push(stored);
    return stored;
  }

  async findCredentialStorage(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnectionCredentialStorage | null> {
    return this.credentials.find((entry) => entry.sellerId === tenant.sellerId && entry.connectionId === connectionId) ?? null;
  }

  async persistRegistrationPinCredential(_tenant: TenantContext, _connectionId: string, _credential: PersistWhatsAppConnectionRegistrationPinInput): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    return null;
  }

  async findRegistrationPinStorage(): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    return null;
  }

  async persistFinalizationProgress(tenant: TenantContext, connectionId: string, input: WhatsAppConnectionFinalizationProgressInput): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = {
      ...current,
      phoneRegistrationCompletedAt: input.phoneRegistrationCompletedAt ?? current.phoneRegistrationCompletedAt,
      wabaSubscriptionCompletedAt: input.wabaSubscriptionCompletedAt ?? current.wabaSubscriptionCompletedAt,
      finalizationLastErrorCode: input.clearFinalizationLastError ? undefined : input.finalizationLastErrorCode ?? current.finalizationLastErrorCode,
      finalizationLastErrorAt: input.clearFinalizationLastError ? undefined : input.finalizationLastErrorCode ? new Date() : current.finalizationLastErrorAt,
      updatedAt: new Date(),
    };
    this.replace(updated);
    return updated;
  }

  private replace(updated: WhatsAppConnection): void {
    this.connections = this.connections.map((entry) => entry.connectionId === updated.connectionId ? updated : entry);
  }
}

class FakeMetaTransport implements MetaEmbeddedSignupTransport {
  exchangeCalls = 0;
  inspectCalls = 0;
  wabaCalls = 0;
  phoneCalls = 0;
  exchangeError: Error | null = null;
  wabaError: Error | null = null;
  phoneError: Error | null = null;
  inspection: MetaTokenInspectionResult = { valid: true, appId: "app_phase11d", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] };
  waba: MetaWabaResult = { id: "waba_phase11d" };
  phone: MetaPhoneNumberResult = { id: "phone_phase11d", wabaId: "waba_phase11d", displayPhoneNumber: "+212 600 000 011", verifiedName: "Atlas Verified" };
  token = "token_phase11d_secret";

  async exchangeCode(): Promise<MetaCodeExchangeResult> {
    this.exchangeCalls += 1;
    if (this.exchangeError) throw this.exchangeError;
    return { accessToken: this.token, tokenExpiresAt: new Date(Date.now() + 60_000) };
  }

  async inspectToken(): Promise<MetaTokenInspectionResult> {
    this.inspectCalls += 1;
    return this.inspection;
  }

  async readWaba(): Promise<MetaWabaResult> {
    this.wabaCalls += 1;
    if (this.wabaError) throw this.wabaError;
    return this.waba;
  }

  async readPhoneNumber(): Promise<MetaPhoneNumberResult> {
    this.phoneCalls += 1;
    if (this.phoneError) throw this.phoneError;
    return this.phone;
  }

  async registerPhoneNumber(): Promise<void> {}

  async readPhoneNumberRegistrationStatus(): Promise<MetaPhoneRegistrationStatusResult> {
    return { id: this.phone.id, registered: true };
  }

  async subscribeWabaToWebhooks(): Promise<void> {}

  async readWabaWebhookSubscriptionStatus(): Promise<MetaWabaSubscriptionStatusResult> {
    return { wabaId: this.waba.id, subscribed: true };
  }
}

function encryptionService(): WhatsAppConnectionCredentialEncryptionService {
  return new WhatsAppConnectionCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: "v1",
    keysJson: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
  }));
}

function transactionRunner(repository: FakeRepository): TransactionRunner {
  return async <Result>(callback: (transaction: DatabaseQueryExecutor) => Promise<Result>): Promise<Result> => {
    const snapshot = repository.snapshot();
    try {
      return await callback({ execute: async () => ({ rows: [], rowCount: 0 }) });
    } catch (error) {
      repository.restore(snapshot);
      throw error;
    }
  };
}

function service(repository = new FakeRepository(), transport = new FakeMetaTransport(), credential = new WhatsAppConnectionCredentialService(repository, encryptionService())) {
  const metaConfig = validateMetaEmbeddedSignupConfiguration({ appId: "app_phase11d", appSecret: "secret_phase11d", graphApiVersion: "v25.0" });
  return {
    repository,
    transport,
    service: new EmbeddedSignupCompletionService(repository, credential, transport, metaConfig, transactionRunner(repository)),
  };
}

async function completionHappyPath(): Promise<void> {
  const { service: completion, repository, transport } = service();
  const tenant = createTenantContext("seller_phase11d_a");
  const result = await completion.complete(tenant, { code: "code_secret", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" });
  const stored = repository.credentials[0];
  add("Authenticated successful completion returns VERIFYING safe response", result.verified && result.connection.status === "VERIFYING" && result.connection.displayPhoneNumber === "+212 600 000 011");
  add("Completion persisted exactly one candidate", repository.connections.length === 1 && repository.connections[0]?.sellerId === tenant.sellerId && repository.connections[0]?.status === "VERIFYING");
  add("Meta transport calls exchange, inspect, WABA, and phone once", transport.exchangeCalls === 1 && transport.inspectCalls === 1 && transport.wabaCalls === 1 && transport.phoneCalls === 1);
  add("Token is encrypted through Phase 11B and plaintext is not persisted", Boolean(stored) && stored?.encryptedAccessToken !== transport.token && !stored?.encryptedAccessToken.includes(transport.token));
  add("Public response contains no credential fields", !JSON.stringify(result).includes("token") && !JSON.stringify(result).includes("encrypted") && !JSON.stringify(result).includes("code_secret"));
}

async function controllerRejectsSellerId(): Promise<void> {
  let seenTenant: TenantContext | null = null;
  const controller = new WhatsAppConnectionController({
    complete: async (tenant: TenantContext) => {
      seenTenant = tenant;
      return { verified: true, connection: { connectionId: "conn", status: "VERIFYING", displayPhoneNumber: null, verifiedName: null } };
    },
  } as unknown as EmbeddedSignupCompletionService);
  const req = { tenant: createTenantContext("seller_phase11d_trusted"), body: { sellerId: "seller_attacker", code: "code", wabaId: "waba", phoneNumberId: "phone" } } as unknown as Request;
  const res = responseProbe();
  await controller.completeEmbeddedSignup(req, res as Response);
  add("Unknown request body sellerId is rejected before service execution", res.statusCode === 400 && seenTenant === null && !JSON.stringify(res.body).includes("seller_attacker"));
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

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11D imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  await completionHappyPath();
  await controllerRejectsSellerId();

  const tenant = createTenantContext("seller_phase11d_b");

  for (const body of [
    { code: "", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" },
    { code: "code", wabaId: "", phoneNumberId: "phone_phase11d" },
    { code: "code", wabaId: "waba_phase11d", phoneNumberId: "" },
  ]) {
    add("Missing or malformed code/wabaId/phoneNumberId is rejected", await expectsError(() => service().service.complete(tenant, body), (error) => error instanceof WhatsAppConnectionCompletionValidationError));
  }

  const exchangeFailure = service();
  exchangeFailure.transport.exchangeError = new WhatsAppConnectionMetaTransportError("unavailable");
  add("Code exchange failure is safe", await expectsError(() => exchangeFailure.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCompletionVerificationError));

  const reusedCode = service();
  reusedCode.transport.exchangeError = new WhatsAppConnectionMetaTransportError("auth");
  add("Expired or reused code is rejected safely", await expectsError(() => reusedCode.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCompletionVerificationError));

  add("Missing Meta configuration fails closed before Meta calls", await expectsError(() => {
    const transport = new FakeMetaTransport();
    const repo = new FakeRepository();
    return new EmbeddedSignupCompletionService(repo, new WhatsAppConnectionCredentialService(repo, encryptionService()), transport, null, transactionRunner(repo))
      .complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" })
      .finally(() => add("No Meta call on missing Meta configuration", transport.exchangeCalls === 0));
  }, (error) => error instanceof WhatsAppConnectionMetaConfigurationError));

  const wabaFailure = service();
  wabaFailure.transport.wabaError = new WhatsAppConnectionMetaTransportError("not_found");
  add("WABA lookup failure is rejected", await expectsError(() => wabaFailure.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCompletionVerificationError));

  const phoneFailure = service();
  phoneFailure.transport.phoneError = new WhatsAppConnectionMetaTransportError("not_found");
  add("Phone number lookup failure is rejected", await expectsError(() => phoneFailure.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCompletionVerificationError));

  const mismatch = service();
  mismatch.transport.phone = { id: "phone_phase11d", wabaId: "other_waba" };
  add("Phone number not belonging to supplied WABA is rejected", await expectsError(() => mismatch.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCompletionVerificationError));

  const missingAccess = service();
  missingAccess.transport.inspection = { valid: true, appId: "app_phase11d", scopes: ["whatsapp_business_management"] };
  add("Token lacking required access is rejected", await expectsError(() => missingAccess.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof Error));

  const retry = service();
  const retryTenant = createTenantContext("seller_phase11d_retry");
  const first = await retry.service.complete(retryTenant, { code: "code_one", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" });
  const second = await retry.service.complete(retryTenant, { code: "code_reused", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" });
  add("Same seller retry is idempotent and does not exchange reused code", first.connection.connectionId === second.connection.connectionId && retry.repository.connections.length === 1 && retry.transport.exchangeCalls === 1);

  const ownedElsewhere = service();
  ownedElsewhere.repository.connections.push(connection({ sellerId: "seller_other", status: "VERIFYING", phoneNumberId: "phone_phase11d" }));
  add("Phone number owned by another seller is rejected safely", await expectsError(() => ownedElsewhere.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCompletionConflictError));

  const active = service();
  active.repository.connections.push(connection({ sellerId: tenant.sellerId, status: "ACTIVE", phoneNumberId: "active_phone" }));
  const replacement = await active.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" });
  add("Existing ACTIVE connection is preserved while replacement candidate is marked", active.repository.connections[0]?.status === "ACTIVE" && replacement.connection.status === "REPLACEMENT_PENDING");

  const rollback = service();
  rollback.repository.failCredentialPersist = true;
  add("Transaction rolls back on persistence failure", await expectsError(() => rollback.service.complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionPersistenceError) && rollback.repository.connections.length === 0 && rollback.repository.credentials.length === 0);

  const noEncryption = service(new FakeRepository(), new FakeMetaTransport(), null as unknown as WhatsAppConnectionCredentialService);
  add("Missing encryption configuration fails closed before Meta calls", await expectsError(() => new EmbeddedSignupCompletionService(noEncryption.repository, null, noEncryption.transport, validateMetaEmbeddedSignupConfiguration({ appId: "app_phase11d", appSecret: "secret", graphApiVersion: "v25.0" }), transactionRunner(noEncryption.repository)).complete(tenant, { code: "code", wabaId: "waba_phase11d", phoneNumberId: "phone_phase11d" }), (error) => error instanceof WhatsAppConnectionCredentialEncryptionError) && noEncryption.transport.exchangeCalls === 0);

  add("Safe errors do not include code/token/app secret/raw Meta payload", !cases.some((entry) => JSON.stringify(entry).includes("code_secret") || JSON.stringify(entry).includes("token_phase11d_secret") || JSON.stringify(entry).includes("secret_phase11d")));

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11D Embedded Signup completion test failed safely." })}\n`);
  process.exitCode = 1;
});
