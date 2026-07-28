import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, getDatabasePoolState, type DatabaseTransactionExecutor, type TenantContext } from "../../../infrastructure/database";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { WhatsAppConnectionCredentialService } from "../application/whatsapp-connection-credential.service";
import { __phase11e1Testing, WhatsAppConnectionFinalizationService } from "../application/whatsapp-connection-finalization.service";
import type { WhatsAppConnectionFinalizationProgressInput, WhatsAppConnectionRepository, VerifiedWhatsAppConnectionMetadataInput } from "../contracts/whatsapp-connection.repository";
import type {
  PersistWhatsAppConnectionCredentialInput,
  PersistWhatsAppConnectionRegistrationPinInput,
  WhatsAppConnectionCredentialStorage,
  WhatsAppConnectionRegistrationPinStorage,
} from "../domain/whatsapp-connection-credentials.types";
import {
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionFinalizationAccessDeniedError,
  WhatsAppConnectionFinalizationConflictError,
  WhatsAppConnectionFinalizationRetryableError,
  WhatsAppConnectionFinalizationValidationError,
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
    connectionId: input.connectionId ?? id("conn_phase11e1"),
    sellerId: input.sellerId,
    provider: "META_WHATSAPP_CLOUD_API",
    status: input.status ?? "VERIFYING",
    metaBusinessId: input.metaBusinessId,
    wabaId: input.wabaId ?? "waba_phase11e1",
    phoneNumberId: input.phoneNumberId ?? "phone_phase11e1",
    displayPhoneNumber: input.displayPhoneNumber,
    verifiedName: input.verifiedName,
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
  failPinPersist = false;
  failProgressPersist = false;

  snapshot(): { connections: WhatsAppConnection[]; credentials: WhatsAppConnectionCredentialStorage[]; pins: WhatsAppConnectionRegistrationPinStorage[] } {
    return {
      connections: this.connections.map((entry) => ({ ...entry })),
      credentials: this.credentials.map((entry) => ({ ...entry })),
      pins: this.pins.map((entry) => ({ ...entry })),
    };
  }

  restore(snapshot: { connections: WhatsAppConnection[]; credentials: WhatsAppConnectionCredentialStorage[]; pins: WhatsAppConnectionRegistrationPinStorage[] }): void {
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
    const updated = { ...current, status, updatedAt: new Date() };
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
    if (this.failPinPersist) throw new WhatsAppConnectionPersistenceError();
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
    if (this.failProgressPersist) throw new WhatsAppConnectionPersistenceError();
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
  registerCalls = 0;
  subscriptionCalls = 0;
  readRegistrationCalls = 0;
  readSubscriptionCalls = 0;
  registered = false;
  subscribed = false;
  registrationError: Error | null = null;
  subscriptionError: Error | null = null;
  registrationReadError: Error | null = null;
  subscriptionReadError: Error | null = null;
  registeredPhoneIds: string[] = [];
  subscribedWabaIds: string[] = [];
  pins: string[] = [];

  async exchangeCode(): Promise<MetaCodeExchangeResult> {
    throw new Error("Phase 11E1 must not exchange Embedded Signup codes.");
  }

  async inspectToken(): Promise<MetaTokenInspectionResult> {
    return { valid: true, scopes: [] };
  }

  async readWaba(wabaId: string): Promise<MetaWabaResult> {
    return { id: wabaId };
  }

  async readPhoneNumber(phoneNumberId: string): Promise<MetaPhoneNumberResult> {
    return { id: phoneNumberId, wabaId: "waba_phase11e1" };
  }

  async registerPhoneNumber(phoneNumberId: string, registrationPin: string): Promise<void> {
    this.registerCalls += 1;
    this.registeredPhoneIds.push(phoneNumberId);
    this.pins.push(registrationPin);
    if (this.registrationError) throw this.registrationError;
    this.registered = true;
  }

  async readPhoneNumberRegistrationStatus(phoneNumberId: string): Promise<MetaPhoneRegistrationStatusResult> {
    this.readRegistrationCalls += 1;
    if (this.registrationReadError) throw this.registrationReadError;
    return { id: phoneNumberId, registered: this.registered };
  }

  async subscribeWabaToWebhooks(wabaId: string): Promise<void> {
    this.subscriptionCalls += 1;
    this.subscribedWabaIds.push(wabaId);
    if (this.subscriptionError) throw this.subscriptionError;
    this.subscribed = true;
  }

  async readWabaWebhookSubscriptionStatus(wabaId: string): Promise<MetaWabaSubscriptionStatusResult> {
    this.readSubscriptionCalls += 1;
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

function fixture(status: WhatsAppConnectionStatus = "VERIFYING") {
  const repository = new FakeRepository();
  const transport = new FakeMetaTransport();
  const encryption = encryptionService();
  const credentialService = new WhatsAppConnectionCredentialService(repository, encryption);
  const tenant = createTenantContext("seller_phase11e1");
  const candidate = connection({ sellerId: tenant.sellerId, status });
  repository.connections.push(candidate);
  const accessToken = `token_phase11e1_${randomUUID().replace(/-/gu, "")}`;
  return credentialService.storeAccessToken(tenant, candidate.connectionId, { accessToken }).then(() => ({
    repository,
    transport,
    encryption,
    credentialService,
    tenant,
    candidate,
    accessToken,
    service: new WhatsAppConnectionFinalizationService(repository, credentialService, transport, async <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => {
      const snapshot = repository.snapshot();
      try {
        return await callback({ execute: async () => ({ rows: [], rowCount: 0 }) });
      } catch (error) {
        repository.restore(snapshot);
        throw error;
      }
    }),
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

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11E1 imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const generatedPins = Array.from({ length: 128 }, () => __phase11e1Testing.generateRegistrationPin());
  add("Server-generated registration PINs are six decimal digits", generatedPins.every((pin) => /^\d{6}$/u.test(pin)));

  const happy = await fixture();
  const result = await happy.service.finalize(happy.tenant, happy.candidate.connectionId);
  const storedPin = happy.repository.pins[0];
  const decryptedPin = storedPin ? happy.encryption.decryptRegistrationPin(storedPin.encryptedRegistrationPin) : "";
  add("Successful finalization registers phone, subscribes WABA, and activates", result.finalized && result.connection.status === "ACTIVE" && result.connection.phoneRegistrationCompleted && result.connection.wabaSubscriptionCompleted && happy.transport.registerCalls === 1 && happy.transport.subscriptionCalls === 1);
  add("PIN is encrypted before persistence", Boolean(storedPin) && /^\d{6}$/u.test(decryptedPin) && storedPin?.encryptedRegistrationPin !== decryptedPin && !storedPin?.encryptedRegistrationPin.includes(decryptedPin));
  add("PIN fingerprint is separate from token fingerprint", Boolean(storedPin) && !storedPin.registrationPinFingerprint.includes(decryptedPin) && storedPin.registrationPinFingerprint !== happy.repository.credentials[0]?.tokenFingerprint);
  add("PIN is never returned in public response", !JSON.stringify(result).includes(decryptedPin) && !JSON.stringify(result).toLowerCase().includes("pin"));
  add("Persisted identifiers are used for Meta operations", happy.transport.registeredPhoneIds[0] === happy.candidate.phoneNumberId && happy.transport.subscribedWabaIds[0] === happy.candidate.wabaId);

  const controllerFixture = await fixture();
  const controller = new WhatsAppConnectionController({} as never, undefined, controllerFixture.service);
  const req = {
    tenant: controllerFixture.tenant,
    params: { connectionId: controllerFixture.candidate.connectionId },
    body: { wabaId: "attacker_waba", phoneNumberId: "attacker_phone", registrationPin: "123456" },
  } as unknown as Request;
  const res = responseProbe();
  await controller.finalizeConnection(req, res as Response);
  add("Finalize HTTP boundary rejects browser-supplied asset identifiers and PIN", res.statusCode === 400 && controllerFixture.transport.registerCalls === 0 && !JSON.stringify(res.body).includes("attacker"));

  const sellerIsolation = await fixture();
  add("Seller isolation prevents finalizing another seller connection", await expectsError(
    () => sellerIsolation.service.finalize(createTenantContext("seller_phase11e1_other"), sellerIsolation.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && sellerIsolation.transport.registerCalls === 0);

  const activeIdempotent = await fixture("ACTIVE");
  const activeIdempotentResult = await activeIdempotent.service.finalize(activeIdempotent.tenant, activeIdempotent.candidate.connectionId);
  add("Already ACTIVE same connection is idempotent", activeIdempotentResult.connection.status === "ACTIVE" && activeIdempotent.transport.registerCalls === 0);

  for (const status of ["DISCONNECTED", "REVOKED", "PENDING"] as const) {
    const invalid = await fixture(status);
    add("Only VERIFYING candidates can be finalized", await expectsError(
      () => invalid.service.finalize(invalid.tenant, invalid.candidate.connectionId),
      (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
    ) && invalid.transport.registerCalls === 0 && invalid.repository.connections[0]?.status === status);
  }

  const alreadyRegistered = await fixture();
  alreadyRegistered.repository.connections[0] = { ...alreadyRegistered.candidate, phoneRegistrationCompletedAt: new Date() };
  alreadyRegistered.transport.registered = true;
  const registeredResult = await alreadyRegistered.service.finalize(alreadyRegistered.tenant, alreadyRegistered.candidate.connectionId);
  add("Already-registered resume skips unsafe duplicate registration", registeredResult.connection.phoneRegistrationCompleted && alreadyRegistered.transport.registerCalls === 0 && alreadyRegistered.transport.subscriptionCalls === 1);

  const alreadySubscribed = await fixture();
  alreadySubscribed.repository.connections[0] = { ...alreadySubscribed.candidate, phoneRegistrationCompletedAt: new Date(), wabaSubscriptionCompletedAt: new Date() };
  alreadySubscribed.transport.registered = true;
  alreadySubscribed.transport.subscribed = true;
  const subscribedResult = await alreadySubscribed.service.finalize(alreadySubscribed.tenant, alreadySubscribed.candidate.connectionId);
  add("Already-subscribed resume is idempotent", subscribedResult.connection.wabaSubscriptionCompleted && alreadySubscribed.transport.registerCalls === 0 && alreadySubscribed.transport.subscriptionCalls === 0);

  const restart = await fixture();
  restart.transport.registered = true;
  const restartResult = await restart.service.finalize(restart.tenant, restart.candidate.connectionId);
  add("Restart between registration and subscription resumes from Meta confirmation", restartResult.connection.phoneRegistrationCompleted && restart.transport.registerCalls === 0 && restart.transport.subscriptionCalls === 1);

  const registrationFailure = await fixture();
  registrationFailure.transport.registrationError = new WhatsAppConnectionMetaTransportError("validation");
  add("Registration failure leaves connection VERIFYING", await expectsError(
    () => registrationFailure.service.finalize(registrationFailure.tenant, registrationFailure.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && registrationFailure.repository.connections[0]?.status === "VERIFYING" && !registrationFailure.repository.connections[0]?.phoneRegistrationCompletedAt);

  const subscriptionFailure = await fixture();
  subscriptionFailure.transport.subscriptionError = new WhatsAppConnectionMetaTransportError("validation");
  add("Subscription failure leaves VERIFYING and preserves registration progress", await expectsError(
    () => subscriptionFailure.service.finalize(subscriptionFailure.tenant, subscriptionFailure.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationVerificationError,
  ) && subscriptionFailure.repository.connections[0]?.status === "VERIFYING" && Boolean(subscriptionFailure.repository.connections[0]?.phoneRegistrationCompletedAt) && !subscriptionFailure.repository.connections[0]?.wabaSubscriptionCompletedAt);

  const ambiguous = await fixture();
  ambiguous.transport.registrationError = new WhatsAppConnectionMetaTransportError("unavailable");
  add("Ambiguous Meta timeout does not falsely mark completion", await expectsError(
    () => ambiguous.service.finalize(ambiguous.tenant, ambiguous.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationRetryableError,
  ) && !ambiguous.repository.connections[0]?.phoneRegistrationCompletedAt && ambiguous.repository.pins.length === 1);

  const revoked = await fixture();
  revoked.repository.credentials = [];
  add("Missing or revoked token fails closed before Meta calls", await expectsError(
    () => revoked.service.finalize(revoked.tenant, revoked.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationAccessDeniedError,
  ) && revoked.transport.registerCalls === 0);

  const undecryptable = await fixture();
  undecryptable.repository.credentials[0] = { ...undecryptable.repository.credentials[0]!, encryptedAccessToken: "{\"v\":1,\"alg\":\"AES-256-GCM\"}" };
  add("Undecryptable token fails closed", await expectsError(
    () => undecryptable.service.finalize(undecryptable.tenant, undecryptable.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationAccessDeniedError,
  ) && undecryptable.transport.registerCalls === 0);

  const activePreserved = await fixture();
  const previousActive = connection({ sellerId: activePreserved.tenant.sellerId, status: "ACTIVE", phoneNumberId: "phone_previous_active", wabaId: "waba_previous_active" });
  activePreserved.repository.connections.push(previousActive);
  add("Previous ACTIVE connection remains unchanged and blocks activation", await expectsError(
    () => activePreserved.service.finalize(activePreserved.tenant, activePreserved.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionFinalizationConflictError,
  ) && activePreserved.repository.connections.find((entry) => entry.connectionId === previousActive.connectionId)?.status === "ACTIVE" && activePreserved.repository.connections.find((entry) => entry.connectionId === activePreserved.candidate.connectionId)?.status === "VERIFYING");

  const publicSafe = await fixture();
  const publicResult = await publicSafe.service.finalize(publicSafe.tenant, publicSafe.candidate.connectionId);
  const publicJson = JSON.stringify(publicResult);
  add("Public response exposes no credential or PIN fields", !publicJson.includes("token") && !publicJson.includes("encrypted") && !publicJson.includes("fingerprint") && !publicJson.includes("registrationPin"));

  const persistenceFailure = await fixture();
  persistenceFailure.repository.failProgressPersist = true;
  add("Persistence failure remains safe and does not activate", await expectsError(
    () => persistenceFailure.service.finalize(persistenceFailure.tenant, persistenceFailure.candidate.connectionId),
    (error) => error instanceof WhatsAppConnectionPersistenceError,
  ) && persistenceFailure.repository.connections[0]?.status === "VERIFYING");

  const badId = await fixture();
  add("Malformed connection id is rejected safely", await expectsError(
    () => badId.service.finalize(badId.tenant, "   "),
    (error) => error instanceof WhatsAppConnectionFinalizationValidationError,
  ));

  const noPlaintextLeaks = !JSON.stringify(cases).includes(happy.accessToken) && !JSON.stringify(cases).includes(decryptedPin);
  add("Test outputs and safe errors contain no plaintext PIN or token", noPlaintextLeaks);

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11E1 finalization test failed safely." })}\n`);
  process.exitCode = 1;
});
