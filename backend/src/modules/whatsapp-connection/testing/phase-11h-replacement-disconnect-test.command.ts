import { randomBytes, randomUUID } from "node:crypto";
import { closeDatabasePool, createTenantContext, getDatabasePoolState, type DatabaseTransactionExecutor, type TenantContext } from "../../../infrastructure/database";
import { EmbeddedSignupCompletionService } from "../application/embedded-signup-completion.service";
import { validateMetaEmbeddedSignupConfiguration } from "../application/meta-embedded-signup.config";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialService } from "../application/whatsapp-connection-credential.service";
import { WhatsAppConnectionDisconnectService } from "../application/whatsapp-connection-disconnect.service";
import { WhatsAppConnectionFinalizationService } from "../application/whatsapp-connection-finalization.service";
import type { WhatsAppConnectionFinalizationProgressInput, WhatsAppConnectionRepository, VerifiedWhatsAppConnectionMetadataInput } from "../contracts/whatsapp-connection.repository";
import type {
  PersistWhatsAppConnectionCredentialInput,
  PersistWhatsAppConnectionRegistrationPinInput,
  WhatsAppConnectionCredentialStorage,
  WhatsAppConnectionRegistrationPinStorage,
} from "../domain/whatsapp-connection-credentials.types";
import {
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionDisconnectConflictError,
  WhatsAppConnectionFinalizationConflictError,
  WhatsAppConnectionFinalizationVerificationError,
  WhatsAppConnectionPersistenceError,
} from "../domain/whatsapp-connection.errors";
import type { ActiveWhatsAppConnectionResolution, WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";
import type {
  MetaCodeExchangeResult,
  MetaEmbeddedSignupTransport,
  MetaPhoneNumberResult,
  MetaPhoneRegistrationStatusResult,
  MetaTokenInspectionResult,
  MetaWabaResult,
  MetaWabaSubscriptionStatusResult,
} from "../infrastructure/meta/meta-embedded-signup.transport";

type TestCase = Readonly<{ name: string; passed: boolean }>;
type Snapshot = Readonly<{
  connections: WhatsAppConnection[];
  credentials: WhatsAppConnectionCredentialStorage[];
  pins: WhatsAppConnectionRegistrationPinStorage[];
}>;

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
    connectionId: input.connectionId ?? id("conn_phase11h"),
    sellerId: input.sellerId,
    provider: "META_WHATSAPP_CLOUD_API",
    status: input.status ?? "VERIFYING",
    metaBusinessId: input.metaBusinessId,
    wabaId: input.wabaId ?? "111111111111111",
    phoneNumberId: input.phoneNumberId ?? "222222222222222",
    displayPhoneNumber: input.displayPhoneNumber ?? "+212 600 000 088",
    verifiedName: input.verifiedName ?? "Phase Eleven H",
    connectedAt: input.connectedAt,
    lastVerifiedAt: input.lastVerifiedAt,
    phoneRegistrationCompletedAt: input.phoneRegistrationCompletedAt,
    wabaSubscriptionCompletedAt: input.wabaSubscriptionCompletedAt,
    finalizationLastErrorCode: input.finalizationLastErrorCode,
    finalizationLastErrorAt: input.finalizationLastErrorAt,
    disconnectedAt: input.disconnectedAt,
    replacedConnectionId: input.replacedConnectionId,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

class FakeRepository implements WhatsAppConnectionRepository {
  connections: WhatsAppConnection[] = [];
  credentials: WhatsAppConnectionCredentialStorage[] = [];
  pins: WhatsAppConnectionRegistrationPinStorage[] = [];
  failReplaceAfterWrite = false;
  sawOldActiveAtReplace = false;

  snapshot(): Snapshot {
    return {
      connections: this.connections.map((entry) => ({ ...entry })),
      credentials: this.credentials.map((entry) => ({ ...entry })),
      pins: this.pins.map((entry) => ({ ...entry })),
    };
  }

  restore(snapshot: Snapshot): void {
    this.connections = snapshot.connections.map((entry) => ({ ...entry }));
    this.credentials = snapshot.credentials.map((entry) => ({ ...entry }));
    this.pins = snapshot.pins.map((entry) => ({ ...entry }));
  }

  async createCandidate(tenant: TenantContext): Promise<WhatsAppConnection> {
    const candidate = connection({ sellerId: tenant.sellerId, status: "PENDING", wabaId: undefined, phoneNumberId: undefined });
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
    return this.connections.find((entry) => entry.sellerId === tenant.sellerId && entry.phoneNumberId === phoneNumberId && ["PENDING", "VERIFYING", "ACTIVE", "REPLACEMENT_PENDING"].includes(entry.status)) ?? null;
  }

  async resolveByPhoneNumberId(phoneNumberId: string): Promise<ActiveWhatsAppConnectionResolution | null> {
    const found = this.connections.find((entry) => entry.phoneNumberId === phoneNumberId && ["PENDING", "VERIFYING", "ACTIVE", "REPLACEMENT_PENDING"].includes(entry.status));
    return found ? { sellerId: found.sellerId, connection: found } : null;
  }

  async resolveActiveByPhoneNumberId(phoneNumberId: string): Promise<ActiveWhatsAppConnectionResolution | null> {
    const found = this.connections.find((entry) => entry.phoneNumberId === phoneNumberId && entry.status === "ACTIVE");
    return found ? { sellerId: found.sellerId, connection: found } : null;
  }

  async updateLifecycleStatus(tenant: TenantContext, connectionId: string, status: WhatsAppConnectionStatus): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const now = new Date();
    const updated = { ...current, status, connectedAt: status === "ACTIVE" ? current.connectedAt ?? now : current.connectedAt, disconnectedAt: status === "DISCONNECTED" ? current.disconnectedAt ?? now : current.disconnectedAt, updatedAt: now };
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

  async activateConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current || current.status !== "VERIFYING") return null;
    const now = new Date();
    const updated = { ...current, status: "ACTIVE" as const, connectedAt: current.connectedAt ?? now, lastVerifiedAt: now, updatedAt: now };
    this.replace(updated);
    return updated;
  }

  async replaceActiveConnection(tenant: TenantContext, activeConnectionId: string, replacementConnectionId: string): Promise<WhatsAppConnection | null> {
    const active = await this.findByConnectionId(tenant, activeConnectionId);
    const replacement = await this.findByConnectionId(tenant, replacementConnectionId);
    this.sawOldActiveAtReplace = active?.status === "ACTIVE" && replacement?.status === "REPLACEMENT_PENDING";
    if (!active || !replacement || active.status !== "ACTIVE" || replacement.status !== "REPLACEMENT_PENDING" || replacement.replacedConnectionId !== active.connectionId) return null;
    const now = new Date();
    this.replace({ ...active, status: "DISCONNECTED", disconnectedAt: active.disconnectedAt ?? now, updatedAt: now });
    const updated = { ...replacement, status: "ACTIVE" as const, connectedAt: now, lastVerifiedAt: now, disconnectedAt: undefined, updatedAt: now };
    this.replace(updated);
    if (this.failReplaceAfterWrite) throw new WhatsAppConnectionPersistenceError();
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
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = {
      ...current,
      metaBusinessId: metadata.metaBusinessId ?? current.metaBusinessId,
      wabaId: metadata.wabaId ?? current.wabaId,
      phoneNumberId: metadata.phoneNumberId ?? current.phoneNumberId,
      displayPhoneNumber: metadata.displayPhoneNumber ?? current.displayPhoneNumber,
      verifiedName: metadata.verifiedName ?? current.verifiedName,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    };
    this.replace(updated);
    return updated;
  }

  async persistAccessTokenCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionCredentialInput): Promise<WhatsAppConnectionCredentialStorage | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
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

  async persistRegistrationPinCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionRegistrationPinInput): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const stored = {
      connectionId,
      sellerId: tenant.sellerId,
      encryptedRegistrationPin: credential.encryptedRegistrationPin,
      registrationPinKeyVersion: credential.registrationPinKeyVersion,
      registrationPinFingerprint: credential.registrationPinFingerprint,
    };
    this.pins = this.pins.filter((entry) => entry.connectionId !== connectionId);
    this.pins.push(stored);
    return stored;
  }

  async findRegistrationPinStorage(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    return this.pins.find((entry) => entry.sellerId === tenant.sellerId && entry.connectionId === connectionId) ?? null;
  }

  async persistFinalizationProgress(tenant: TenantContext, connectionId: string, input: WhatsAppConnectionFinalizationProgressInput): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = {
      ...current,
      phoneRegistrationCompletedAt: current.phoneRegistrationCompletedAt ?? input.phoneRegistrationCompletedAt ?? undefined,
      wabaSubscriptionCompletedAt: current.wabaSubscriptionCompletedAt ?? input.wabaSubscriptionCompletedAt ?? undefined,
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
  registered = true;
  subscribed = true;

  async exchangeCode(): Promise<MetaCodeExchangeResult> {
    this.exchangeCalls += 1;
    return { accessToken: `token_phase11h_${randomUUID().replace(/-/gu, "")}` };
  }

  async inspectToken(): Promise<MetaTokenInspectionResult> {
    this.inspectCalls += 1;
    return { valid: true, appId: "app_phase11h", scopes: [] };
  }

  async readWaba(wabaId: string): Promise<MetaWabaResult> {
    return { id: wabaId };
  }

  async readPhoneNumber(phoneNumberId: string): Promise<MetaPhoneNumberResult> {
    return { id: phoneNumberId, wabaId: "333333333333333", displayPhoneNumber: "+212 600 000 088", verifiedName: "Phase Eleven H" };
  }

  async registerPhoneNumber(): Promise<void> {
    return undefined;
  }

  async readPhoneNumberRegistrationStatus(phoneNumberId: string): Promise<MetaPhoneRegistrationStatusResult> {
    return { id: phoneNumberId, registered: this.registered };
  }

  async subscribeWabaToWebhooks(): Promise<void> {
    return undefined;
  }

  async readWabaWebhookSubscriptionStatus(wabaId: string): Promise<MetaWabaSubscriptionStatusResult> {
    return { wabaId, subscribed: this.subscribed };
  }
}

function encryptionService(): WhatsAppConnectionCredentialEncryptionService {
  return new WhatsAppConnectionCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: "v1",
    keysJson: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
  }));
}

function transactionRunner(repository: FakeRepository) {
  return async <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>): Promise<Result> => {
    const snapshot = repository.snapshot();
    try {
      return await callback({ execute: async () => ({ rows: [], rowCount: 0 }) });
    } catch (error) {
      repository.restore(snapshot);
      throw error;
    }
  };
}

function harness() {
  const repository = new FakeRepository();
  const transport = new FakeMetaTransport();
  const credentialService = new WhatsAppConnectionCredentialService(repository, encryptionService());
  const runner = transactionRunner(repository);
  return {
    repository,
    transport,
    credentialService,
    completion: new EmbeddedSignupCompletionService(
      repository,
      credentialService,
      transport,
      validateMetaEmbeddedSignupConfiguration({ appId: "app_phase11h", appSecret: "secret_phase11h", graphApiVersion: "v25.0" }),
      runner,
    ),
    finalization: new WhatsAppConnectionFinalizationService(repository, credentialService, transport, runner),
    disconnect: new WhatsAppConnectionDisconnectService(repository, runner),
  };
}

async function makeReadyReplacement(fixture = harness(), tenant = createTenantContext("seller_phase11h")) {
  const old = connection({ sellerId: tenant.sellerId, status: "ACTIVE", phoneNumberId: "111111111111111", wabaId: "999999999999999", connectedAt: new Date() });
  fixture.repository.connections.push(old);
  const completed = await fixture.completion.complete(tenant, { code: "code_phase11h", wabaId: "333333333333333", phoneNumberId: "222222222222222" });
  const candidate = fixture.repository.connections.find((entry) => entry.connectionId === completed.connection.connectionId);
  if (!candidate) throw new Error("missing candidate");
  await fixture.repository.persistFinalizationProgress(tenant, candidate.connectionId, {
    phoneRegistrationCompletedAt: new Date(),
    wabaSubscriptionCompletedAt: new Date(),
    clearFinalizationLastError: true,
  });
  return { fixture, tenant, old, candidate };
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11H imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const normal = harness();
  const normalTenant = createTenantContext("seller_phase11h_normal");
  const normalResult = await normal.completion.complete(normalTenant, { code: "code", wabaId: "333333333333333", phoneNumberId: "222222222222222" });
  await normal.repository.persistFinalizationProgress(normalTenant, normalResult.connection.connectionId, { phoneRegistrationCompletedAt: new Date(), wabaSubscriptionCompletedAt: new Date() });
  const normalActivated = await normal.finalization.activateReadyConnection(normalTenant, normalResult.connection.connectionId);
  add("seller with no ACTIVE connection still activates normally", normalResult.connection.status === "VERIFYING" && normalActivated.connection.status === "ACTIVE");

  const replacement = await makeReadyReplacement();
  const replacementResult = await replacement.fixture.finalization.activateReadyConnection(replacement.tenant, replacement.candidate.connectionId);
  const oldAfter = replacement.fixture.repository.connections.find((entry) => entry.connectionId === replacement.old.connectionId);
  const newAfter = replacement.fixture.repository.connections.find((entry) => entry.connectionId === replacement.candidate.connectionId);
  add("fully ready replacement candidate atomically replaces old ACTIVE", replacementResult.connection.status === "ACTIVE" && oldAfter?.status === "DISCONNECTED" && newAfter?.status === "ACTIVE");
  add("old connection remains ACTIVE until switch commits", replacement.fixture.repository.sawOldActiveAtReplace);
  add("no outcome leaves two ACTIVE connections", replacement.fixture.repository.connections.filter((entry) => entry.sellerId === replacement.tenant.sellerId && entry.status === "ACTIVE").length === 1);
  add("old phone_number_id no longer resolves inbound after replacement", await replacement.fixture.repository.resolveActiveByPhoneNumberId("111111111111111") === null);

  const failedReadiness = await makeReadyReplacement();
  failedReadiness.fixture.transport.registered = false;
  add("failed readiness leaves old connection ACTIVE", await expectsError(
    () => failedReadiness.fixture.finalization.activateReadyConnection(failedReadiness.tenant, failedReadiness.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && failedReadiness.fixture.repository.connections.find((entry) => entry.connectionId === failedReadiness.old.connectionId)?.status === "ACTIVE");

  const rollback = await makeReadyReplacement();
  rollback.fixture.repository.failReplaceAfterWrite = true;
  add("transaction failure rolls back old and new statuses", await expectsError(
    () => rollback.fixture.finalization.activateReadyConnection(rollback.tenant, rollback.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionPersistenceError,
  ) && rollback.fixture.repository.connections.find((entry) => entry.connectionId === rollback.old.connectionId)?.status === "ACTIVE" && rollback.fixture.repository.connections.find((entry) => entry.connectionId === rollback.candidate.connectionId)?.status === "REPLACEMENT_PENDING");

  const unapproved = await makeReadyReplacement();
  await unapproved.fixture.repository.updateLifecycleStatus(unapproved.tenant, unapproved.candidate.connectionId, "VERIFYING");
  add("unapproved candidate cannot replace", await expectsError(
    () => unapproved.fixture.finalization.activateReadyConnection(unapproved.tenant, unapproved.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && unapproved.fixture.repository.connections.find((entry) => entry.connectionId === unapproved.old.connectionId)?.status === "ACTIVE");

  const isolation = await makeReadyReplacement();
  const isolationInspectCalls = isolation.fixture.transport.inspectCalls;
  add("another seller's candidate cannot replace", await expectsError(
    () => isolation.fixture.finalization.activateReadyConnection(createTenantContext("seller_phase11h_other"), isolation.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && isolation.fixture.transport.inspectCalls === isolationInspectCalls);

  const concurrent = harness();
  const concurrentTenant = createTenantContext("seller_phase11h_concurrent");
  concurrent.repository.connections.push(connection({ sellerId: concurrentTenant.sellerId, status: "ACTIVE", phoneNumberId: "101010101010101" }));
  const first = await concurrent.completion.complete(concurrentTenant, { code: "code_one", wabaId: "333333333333333", phoneNumberId: "202020202020202" });
  const second = await concurrent.completion.complete(concurrentTenant, { code: "code_two", wabaId: "333333333333333", phoneNumberId: "303030303030303" });
  for (const candidateId of [first.connection.connectionId, second.connection.connectionId]) {
    await concurrent.repository.persistFinalizationProgress(concurrentTenant, candidateId, { phoneRegistrationCompletedAt: new Date(), wabaSubscriptionCompletedAt: new Date() });
  }
  await concurrent.finalization.activateReadyConnection(concurrentTenant, first.connection.connectionId);
  add("concurrent replacement attempts preserve one ACTIVE connection", await expectsError(
    () => concurrent.finalization.activateReadyConnection(concurrentTenant, second.connection.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && concurrent.repository.connections.filter((entry) => entry.sellerId === concurrentTenant.sellerId && entry.status === "ACTIVE").length === 1);

  const disconnect = harness();
  const disconnectTenant = createTenantContext("seller_phase11h_disconnect");
  const active = connection({ sellerId: disconnectTenant.sellerId, status: "ACTIVE", phoneNumberId: "404040404040404", connectedAt: new Date() });
  disconnect.repository.connections.push(active);
  const disconnected = await disconnect.disconnect.disconnect(disconnectTenant, active.connectionId);
  add("disconnect own ACTIVE connection succeeds", disconnected.connection.status === "DISCONNECTED");
  add("disconnect sets DISCONNECTED and disconnected_at", disconnect.repository.connections[0]?.status === "DISCONNECTED" && disconnect.repository.connections[0]?.disconnectedAt instanceof Date);
  add("seller no longer resolves outbound after disconnect", await disconnect.repository.findActiveBySeller(disconnectTenant) === null);
  add("old phone_number_id no longer resolves inbound after disconnect", await disconnect.repository.resolveActiveByPhoneNumberId("404040404040404") === null);
  const duplicate = await disconnect.disconnect.disconnect(disconnectTenant, active.connectionId);
  add("duplicate disconnect is safe", duplicate.disconnected && duplicate.connection.status === "DISCONNECTED");
  add("another seller cannot disconnect", await expectsError(
    () => disconnect.disconnect.disconnect(createTenantContext("seller_phase11h_attacker"), active.connectionId),
    (error) => error instanceof WhatsAppConnectionDisconnectConflictError,
  ));

  const reconnect = harness();
  const reconnectTenant = createTenantContext("seller_phase11h_reconnect");
  reconnect.repository.connections.push(connection({ sellerId: reconnectTenant.sellerId, status: "DISCONNECTED", phoneNumberId: "505050505050505", disconnectedAt: new Date() }));
  const reconnected = await reconnect.completion.complete(reconnectTenant, { code: "code", wabaId: "333333333333333", phoneNumberId: "505050505050505" });
  add("reconnect through a new verified candidate works", reconnected.connection.status === "VERIFYING" && reconnect.repository.connections.length === 2);

  const conflict = harness();
  conflict.repository.connections.push(connection({ sellerId: "seller_phase11h_owner", status: "ACTIVE", phoneNumberId: "606060606060606" }));
  add("phone owned by another current seller cannot be completed", await expectsError(
    () => conflict.completion.complete(createTenantContext("seller_phase11h_conflict"), { code: "code", wabaId: "333333333333333", phoneNumberId: "606060606060606" }),
    (error) => error instanceof WhatsAppConnectionCompletionConflictError,
  ));

  const safeJson = JSON.stringify([normalResult, replacementResult, disconnected, reconnected]);
  add("no credentials or sensitive metadata appear in responses", !/token|pin|fingerprint|encrypted|333333333333333|606060606060606|secret/i.test(safeJson));

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11H replacement and disconnect test failed safely." })}\n`);
  process.exitCode = 1;
});
