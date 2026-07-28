import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, getDatabasePoolState, type DatabaseTransactionExecutor, type TenantContext } from "../../../infrastructure/database";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { WhatsAppConnectionCredentialService } from "../application/whatsapp-connection-credential.service";
import { WhatsAppConnectionFinalizationService } from "../application/whatsapp-connection-finalization.service";
import type { WhatsAppConnectionFinalizationProgressInput, WhatsAppConnectionRepository, VerifiedWhatsAppConnectionMetadataInput } from "../contracts/whatsapp-connection.repository";
import type {
  PersistWhatsAppConnectionCredentialInput,
  PersistWhatsAppConnectionRegistrationPinInput,
  WhatsAppConnectionCredentialStorage,
  WhatsAppConnectionRegistrationPinStorage,
} from "../domain/whatsapp-connection-credentials.types";
import {
  WhatsAppConnectionFinalizationAccessDeniedError,
  WhatsAppConnectionFinalizationConflictError,
  WhatsAppConnectionFinalizationRetryableError,
  WhatsAppConnectionFinalizationVerificationError,
  WhatsAppConnectionMetaTransportError,
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
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";

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
    connectionId: input.connectionId ?? id("conn_phase11e2"),
    sellerId: input.sellerId,
    provider: "META_WHATSAPP_CLOUD_API",
    status: input.status ?? "VERIFYING",
    metaBusinessId: input.metaBusinessId,
    wabaId: input.wabaId ?? "waba_phase11e2",
    phoneNumberId: input.phoneNumberId ?? "phone_phase11e2",
    displayPhoneNumber: input.displayPhoneNumber ?? "+212 600 000 022",
    verifiedName: input.verifiedName ?? "Atlas Ready",
    connectedAt: input.connectedAt,
    lastVerifiedAt: input.lastVerifiedAt,
    phoneRegistrationCompletedAt: input.phoneRegistrationCompletedAt,
    wabaSubscriptionCompletedAt: input.wabaSubscriptionCompletedAt,
    finalizationLastErrorCode: input.finalizationLastErrorCode,
    finalizationLastErrorAt: input.finalizationLastErrorAt,
    disconnectedAt: input.disconnectedAt,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

class FakeRepository implements WhatsAppConnectionRepository {
  connections: WhatsAppConnection[] = [];
  credentials: WhatsAppConnectionCredentialStorage[] = [];
  pins: WhatsAppConnectionRegistrationPinStorage[] = [];
  failActivateAfterWrite = false;

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
    const candidate = connection({ sellerId: tenant.sellerId, status: "PENDING" });
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
    const now = new Date();
    const updated = { ...current, status, connectedAt: status === "ACTIVE" ? current.connectedAt ?? now : current.connectedAt, updatedAt: now };
    this.replace(updated);
    return updated;
  }

  async activateConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current || current.status !== "VERIFYING") return null;
    const now = new Date();
    const updated = { ...current, status: "ACTIVE" as const, connectedAt: current.connectedAt ?? now, lastVerifiedAt: now, updatedAt: now };
    this.replace(updated);
    if (this.failActivateAfterWrite) throw new WhatsAppConnectionPersistenceError();
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
  inspectCalls = 0;
  wabaCalls = 0;
  phoneCalls = 0;
  registrationReadCalls = 0;
  subscriptionReadCalls = 0;
  registerCalls = 0;
  subscribeCalls = 0;
  tokenValid = true;
  registered = true;
  subscribed = true;
  phoneWabaId = "waba_phase11e2";
  wabaError: Error | null = null;
  phoneError: Error | null = null;
  registrationReadError: Error | null = null;
  subscriptionReadError: Error | null = null;

  async exchangeCode(): Promise<MetaCodeExchangeResult> {
    throw new Error("Phase 11E2 must not exchange Embedded Signup codes.");
  }

  async inspectToken(): Promise<MetaTokenInspectionResult> {
    this.inspectCalls += 1;
    return { valid: this.tokenValid, scopes: [] };
  }

  async readWaba(wabaId: string): Promise<MetaWabaResult> {
    this.wabaCalls += 1;
    if (this.wabaError) throw this.wabaError;
    return { id: wabaId };
  }

  async readPhoneNumber(phoneNumberId: string): Promise<MetaPhoneNumberResult> {
    this.phoneCalls += 1;
    if (this.phoneError) throw this.phoneError;
    return { id: phoneNumberId, wabaId: this.phoneWabaId };
  }

  async registerPhoneNumber(): Promise<void> {
    this.registerCalls += 1;
  }

  async readPhoneNumberRegistrationStatus(phoneNumberId: string): Promise<MetaPhoneRegistrationStatusResult> {
    this.registrationReadCalls += 1;
    if (this.registrationReadError) throw this.registrationReadError;
    return { id: phoneNumberId, registered: this.registered };
  }

  async subscribeWabaToWebhooks(): Promise<void> {
    this.subscribeCalls += 1;
  }

  async readWabaWebhookSubscriptionStatus(wabaId: string): Promise<MetaWabaSubscriptionStatusResult> {
    this.subscriptionReadCalls += 1;
    if (this.subscriptionReadError) throw this.subscriptionReadError;
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

async function fixture(status: WhatsAppConnectionStatus = "VERIFYING") {
  const repository = new FakeRepository();
  const transport = new FakeMetaTransport();
  const credentialEncryption = encryptionService();
  const credentialService = new WhatsAppConnectionCredentialService(repository, credentialEncryption);
  const tenant = createTenantContext("seller_phase11e2");
  const candidate = connection({
    sellerId: tenant.sellerId,
    status,
    phoneRegistrationCompletedAt: new Date(),
    wabaSubscriptionCompletedAt: new Date(),
  });
  repository.connections.push(candidate);
  const accessToken = `token_phase11e2_${randomUUID().replace(/-/gu, "")}`;
  await credentialService.storeAccessToken(tenant, candidate.connectionId, { accessToken });
  return {
    repository,
    transport,
    credentialService,
    tenant,
    candidate,
    accessToken,
    service: new WhatsAppConnectionFinalizationService(repository, credentialService, transport, transactionRunner(repository)),
  };
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
  add("Phase 11E2 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const ready = await fixture();
  const activated = await ready.service.activateReadyConnection(ready.tenant, ready.candidate.connectionId);
  const storedReady = ready.repository.connections[0];
  add("Fully ready VERIFYING connection becomes ACTIVE", activated.connection.status === "ACTIVE" && storedReady?.status === "ACTIVE");
  add("Activation persists connected_at and last_verified_at", storedReady?.connectedAt instanceof Date && storedReady.lastVerifiedAt instanceof Date);
  add("Readiness verification uses reads only and no WhatsApp send or E1 POST calls", ready.transport.inspectCalls === 1 && ready.transport.wabaCalls === 1 && ready.transport.phoneCalls === 1 && ready.transport.registrationReadCalls === 1 && ready.transport.subscriptionReadCalls === 1 && ready.transport.registerCalls === 0 && ready.transport.subscribeCalls === 0);

  const alreadyActive = await fixture("ACTIVE");
  const alreadyActiveResult = await alreadyActive.service.activateReadyConnection(alreadyActive.tenant, alreadyActive.candidate.connectionId);
  add("Already ACTIVE same connection is idempotent", alreadyActiveResult.connection.status === "ACTIVE" && alreadyActive.transport.inspectCalls === 0);

  const activeBlock = await fixture();
  const previousActive = connection({ sellerId: activeBlock.tenant.sellerId, status: "ACTIVE", phoneNumberId: "phone_previous_active", wabaId: "waba_previous_active" });
  activeBlock.repository.connections.push(previousActive);
  add("Another existing ACTIVE connection is preserved and blocks activation", await expectsError(
    () => activeBlock.service.activateReadyConnection(activeBlock.tenant, activeBlock.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && activeBlock.repository.connections.find((entry) => entry.connectionId === previousActive.connectionId)?.status === "ACTIVE" && activeBlock.repository.connections.find((entry) => entry.connectionId === activeBlock.candidate.connectionId)?.status === "VERIFYING");

  const missingRegistration = await fixture();
  missingRegistration.repository.connections[0] = { ...missingRegistration.candidate, phoneRegistrationCompletedAt: undefined };
  add("Missing E1 registration marker blocks activation", await expectsError(
    () => missingRegistration.service.activateReadyConnection(missingRegistration.tenant, missingRegistration.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && missingRegistration.repository.connections[0]?.status === "VERIFYING");

  const missingSubscription = await fixture();
  missingSubscription.repository.connections[0] = { ...missingSubscription.candidate, wabaSubscriptionCompletedAt: undefined };
  add("Missing E1 subscription marker blocks activation", await expectsError(
    () => missingSubscription.service.activateReadyConnection(missingSubscription.tenant, missingSubscription.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && missingSubscription.repository.connections[0]?.status === "VERIFYING");

  const invalidToken = await fixture();
  invalidToken.transport.tokenValid = false;
  add("Invalid or revoked token blocks activation", await expectsError(
    () => invalidToken.service.activateReadyConnection(invalidToken.tenant, invalidToken.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationAccessDeniedError,
  ) && invalidToken.repository.connections[0]?.status === "VERIFYING");

  const wabaFailure = await fixture();
  wabaFailure.transport.wabaError = new WhatsAppConnectionMetaTransportError("auth");
  add("WABA access failure blocks activation", await expectsError(
    () => wabaFailure.service.activateReadyConnection(wabaFailure.tenant, wabaFailure.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationAccessDeniedError,
  ) && wabaFailure.repository.connections[0]?.status === "VERIFYING");

  const mismatch = await fixture();
  mismatch.transport.phoneWabaId = "other_waba";
  add("Phone/WABA mismatch blocks activation", await expectsError(
    () => mismatch.service.activateReadyConnection(mismatch.tenant, mismatch.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && mismatch.repository.connections[0]?.status === "VERIFYING");

  const unregistered = await fixture();
  unregistered.transport.registered = false;
  add("Unregistered phone blocks activation", await expectsError(
    () => unregistered.service.activateReadyConnection(unregistered.tenant, unregistered.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && unregistered.repository.connections[0]?.status === "VERIFYING");

  const unsubscribed = await fixture();
  unsubscribed.transport.subscribed = false;
  add("Missing app subscription blocks activation", await expectsError(
    () => unsubscribed.service.activateReadyConnection(unsubscribed.tenant, unsubscribed.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && unsubscribed.repository.connections[0]?.status === "VERIFYING");

  const timeout = await fixture();
  timeout.transport.registrationReadError = new WhatsAppConnectionMetaTransportError("unavailable");
  add("Ambiguous Meta timeout does not activate", await expectsError(
    () => timeout.service.activateReadyConnection(timeout.tenant, timeout.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationRetryableError,
  ) && timeout.repository.connections[0]?.status === "VERIFYING" && !timeout.repository.connections[0]?.connectedAt);

  const rollback = await fixture();
  rollback.repository.failActivateAfterWrite = true;
  add("Persistence failure rolls back activation", await expectsError(
    () => rollback.service.activateReadyConnection(rollback.tenant, rollback.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionPersistenceError,
  ) && rollback.repository.connections[0]?.status === "VERIFYING" && !rollback.repository.connections[0]?.connectedAt);

  const isolation = await fixture();
  add("Seller isolation blocks activation of another seller connection", await expectsError(
    () => isolation.service.activateReadyConnection(createTenantContext("seller_phase11e2_other"), isolation.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && isolation.transport.inspectCalls === 0);

  const requestBoundary = await fixture();
  const controller = new WhatsAppConnectionController({} as never, requestBoundary.service);
  const req = {
    tenant: requestBoundary.tenant,
    params: { connectionId: requestBoundary.candidate.connectionId },
    body: { sellerId: "attacker", wabaId: "attacker_waba", phoneNumberId: "attacker_phone", status: "ACTIVE", token: "attacker_token", pin: "123456" },
  } as unknown as Request;
  const res = responseProbe();
  await controller.finalizeConnection(req, res as Response);
  add("Request data cannot override persisted identifiers or activation status", res.statusCode === 400 && requestBoundary.transport.inspectCalls === 0 && !JSON.stringify(res.body).includes("attacker"));

  const safe = await fixture();
  const safeResult = await safe.service.activateReadyConnection(safe.tenant, safe.candidate.connectionId);
  const safeJson = JSON.stringify(safeResult);
  add("Safe response contains no token, PIN, fingerprint, or encrypted fields", !safeJson.includes("token") && !safeJson.toLowerCase().includes("pin") && !safeJson.includes("fingerprint") && !safeJson.includes("encrypted"));

  add("Test outputs and errors contain no plaintext token", !JSON.stringify(cases).includes(ready.accessToken));

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11E2 activation test failed safely." })}\n`);
  process.exitCode = 1;
});
