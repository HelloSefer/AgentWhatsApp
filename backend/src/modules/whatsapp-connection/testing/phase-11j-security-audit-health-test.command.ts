import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, getDatabasePoolState, type TenantContext } from "../../../infrastructure/database";
import { roleHasPermission } from "../../auth";
import { receiveWhatsAppCloudWebhook, setCloudWebhookProcessorForTesting, setWhatsAppActiveConnectionResolverForTesting, setWhatsAppInboundProducerProviderForTesting } from "../../whatsapp/cloud/whatsapp-cloud.controller";
import type { WhatsAppInboundJobInputData } from "../../whatsapp/cloud/inbound-queue/whatsapp-inbound-job.types";
import type { WhatsAppInboundProducerService } from "../../whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";
import { PersistentWhatsAppOutboundConnectionResolver } from "../../whatsapp/cloud/outbound-connection/whatsapp-outbound-connection-resolver";
import { WhatsAppOutboundError } from "../../whatsapp/cloud/outbound-queue/whatsapp-outbound.errors";
import { env } from "../../../config/env";
import { EmbeddedSignupCompletionService } from "../application/embedded-signup-completion.service";
import { validateMetaEmbeddedSignupConfiguration } from "../application/meta-embedded-signup.config";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import { WhatsAppConnectionDisconnectService } from "../application/whatsapp-connection-disconnect.service";
import {
  setWhatsAppConnectionOperationalRecorderForTesting,
  type WhatsAppConnectionOperationalPayload,
} from "../application/whatsapp-connection-operational-events";
import { WhatsAppConnectionFinalizationService } from "../application/whatsapp-connection-finalization.service";
import type { WhatsAppConnectionRepository, WhatsAppConnectionFinalizationProgressInput, VerifiedWhatsAppConnectionMetadataInput } from "../contracts/whatsapp-connection.repository";
import type { PersistWhatsAppConnectionCredentialInput, PersistWhatsAppConnectionRegistrationPinInput, WhatsAppConnectionCredentialStorage, WhatsAppConnectionRegistrationPinStorage } from "../domain/whatsapp-connection-credentials.types";
import { WhatsAppConnectionCredentialEncryptionError, WhatsAppConnectionCredentialService, WhatsAppConnectionMetaConfigurationError, WhatsAppConnectionCredentialEncryptionService, WhatsAppConnectionFinalizationAccessDeniedError } from "../index";
import type { ActiveWhatsAppConnectionResolution, WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";
import type { MetaCodeExchangeResult, MetaEmbeddedSignupTransport, MetaPhoneNumberResult, MetaPhoneRegistrationStatusResult, MetaTokenInspectionResult, MetaWabaResult, MetaWabaSubscriptionStatusResult } from "../infrastructure/meta/meta-embedded-signup.transport";

type TestCase = Readonly<{ name: string; passed: boolean }>;
type EventRecord = Readonly<{ type: "audit" | "metric" | "observation"; name: string; payload: WhatsAppConnectionOperationalPayload; value?: number }>;

const cases: TestCase[] = [];
const events: EventRecord[] = [];

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

function connection(input: Partial<WhatsAppConnection> & { connectionId: string; sellerId: string; status: WhatsAppConnectionStatus }): WhatsAppConnection {
  const now = new Date("2026-07-28T12:00:00.000Z");
  return {
    connectionId: input.connectionId,
    sellerId: input.sellerId,
    provider: "META_WHATSAPP_CLOUD_API",
    status: input.status,
    metaBusinessId: input.metaBusinessId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
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

  async createCandidate(tenant: TenantContext): Promise<WhatsAppConnection> {
    const candidate = connection({ connectionId: `conn_${this.connections.length + 1}`, sellerId: tenant.sellerId, status: "PENDING" });
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
    return this.connections.filter((entry) => entry.sellerId === tenant.sellerId);
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
    const updated = { ...current, status, connectedAt: status === "ACTIVE" ? current.connectedAt ?? new Date() : current.connectedAt, lastVerifiedAt: status === "ACTIVE" ? new Date() : current.lastVerifiedAt, updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async markReplacementPending(tenant: TenantContext, connectionId: string, replacedConnectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = { ...current, status: "REPLACEMENT_PENDING" as const, replacedConnectionId, updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async replaceActiveConnection(tenant: TenantContext, activeConnectionId: string, replacementConnectionId: string): Promise<WhatsAppConnection | null> {
    const active = await this.findByConnectionId(tenant, activeConnectionId);
    const replacement = await this.findByConnectionId(tenant, replacementConnectionId);
    if (!active || !replacement || active.status !== "ACTIVE" || replacement.status !== "REPLACEMENT_PENDING") return null;
    this.replace({ ...active, status: "DISCONNECTED", disconnectedAt: new Date(), updatedAt: new Date() });
    const updated = { ...replacement, status: "ACTIVE" as const, connectedAt: new Date(), lastVerifiedAt: new Date(), updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async disconnectActiveConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current || current.status !== "ACTIVE") return null;
    const updated = { ...current, status: "DISCONNECTED" as const, disconnectedAt: new Date(), updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async persistVerifiedMetadata(tenant: TenantContext, connectionId: string, metadata: VerifiedWhatsAppConnectionMetadataInput): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = { ...current, wabaId: metadata.wabaId ?? undefined, phoneNumberId: metadata.phoneNumberId ?? undefined, displayPhoneNumber: metadata.displayPhoneNumber ?? undefined, verifiedName: metadata.verifiedName ?? undefined, lastVerifiedAt: new Date(), updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async persistAccessTokenCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionCredentialInput): Promise<WhatsAppConnectionCredentialStorage | null> {
    const stored = { connectionId, sellerId: tenant.sellerId, encryptedAccessToken: credential.encryptedAccessToken, tokenKeyVersion: credential.tokenKeyVersion, tokenFingerprint: credential.tokenFingerprint, tokenExpiresAt: credential.tokenExpiresAt ?? undefined };
    this.credentials = this.credentials.filter((entry) => entry.connectionId !== connectionId);
    this.credentials.push(stored);
    return stored;
  }

  async findCredentialStorage(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnectionCredentialStorage | null> {
    return this.credentials.find((entry) => entry.sellerId === tenant.sellerId && entry.connectionId === connectionId) ?? null;
  }

  async persistRegistrationPinCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionRegistrationPinInput): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    const stored = { connectionId, sellerId: tenant.sellerId, encryptedRegistrationPin: credential.encryptedRegistrationPin, registrationPinKeyVersion: credential.registrationPinKeyVersion, registrationPinFingerprint: credential.registrationPinFingerprint };
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

  async activateConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    return this.updateLifecycleStatus(tenant, connectionId, "ACTIVE");
  }

  private replace(updated: WhatsAppConnection): void {
    this.connections = this.connections.map((entry) => entry.connectionId === updated.connectionId ? updated : entry);
  }
}

class FakeMetaTransport implements MetaEmbeddedSignupTransport {
  async exchangeCode(): Promise<MetaCodeExchangeResult> {
    return { accessToken: "token_phase11j_secret" };
  }
  async inspectToken(): Promise<MetaTokenInspectionResult> {
    return { valid: true, appId: "app_phase11j", scopes: [] };
  }
  async readWaba(wabaId: string): Promise<MetaWabaResult> {
    return { id: wabaId };
  }
  async readPhoneNumber(phoneNumberId: string): Promise<MetaPhoneNumberResult> {
    return { id: phoneNumberId, wabaId: "333333333333333", displayPhoneNumber: "+212 600 000 011", verifiedName: "Phase 11J Shop" };
  }
  async registerPhoneNumber(): Promise<void> {
    return undefined;
  }
  async readPhoneNumberRegistrationStatus(phoneNumberId: string): Promise<MetaPhoneRegistrationStatusResult> {
    return { id: phoneNumberId, registered: true };
  }
  async subscribeWabaToWebhooks(): Promise<void> {
    return undefined;
  }
  async readWabaWebhookSubscriptionStatus(wabaId: string): Promise<MetaWabaSubscriptionStatusResult> {
    return { wabaId, subscribed: true };
  }
}

function fakeCredentialService(input: Readonly<{ throwDecrypt?: boolean; token?: string | null }> = {}): WhatsAppConnectionCredentialService {
  return {
    storeAccessToken: async (tenant: TenantContext, connectionId: string) => ({ connectionId, sellerId: tenant.sellerId, encryptedAccessToken: "encrypted_envelope", tokenKeyVersion: "v1", tokenFingerprint: "fingerprint_secret" }),
    getCredentialStorage: async (tenant: TenantContext, connectionId: string) => ({ connectionId, sellerId: tenant.sellerId, encryptedAccessToken: "encrypted_envelope", tokenKeyVersion: "v1", tokenFingerprint: "fingerprint_secret" }),
    decryptStoredAccessToken: async () => {
      if (input.throwDecrypt) throw new WhatsAppConnectionCredentialEncryptionError();
      return input.token ?? "runtime_token_secret";
    },
    decryptStoredRegistrationPin: async () => "123456",
    storeRegistrationPin: async (tenant: TenantContext, connectionId: string) => ({ connectionId, sellerId: tenant.sellerId, encryptedRegistrationPin: "encrypted_pin_secret", registrationPinKeyVersion: "v1", registrationPinFingerprint: "pin_fingerprint_secret" }),
  } as unknown as WhatsAppConnectionCredentialService;
}

function fakeRequest(body: unknown): Request {
  return { body, query: {}, protocol: "http", header: () => undefined, get: () => "localhost:5000" } as unknown as Request;
}

function fakeResponse(): { response: Response; finished: Promise<{ status: number; body: unknown }> } {
  let status = 200;
  let resolveFinished: (value: { status: number; body: unknown }) => void = () => undefined;
  const finished = new Promise<{ status: number; body: unknown }>((resolve) => { resolveFinished = resolve; });
  const response = {
    status: (next: number) => { status = next; return response; },
    json: (body: unknown) => { resolveFinished({ status, body }); return response; },
    send: (body: unknown) => { resolveFinished({ status, body }); return response; },
    type: () => response,
  } as unknown as Response;
  return { response, finished };
}

function webhookBody(phoneNumberId: string): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: "212600000001" }], messages: [{ id: "wamid.phase11j", from: "212600000001", type: "text", text: { body: "hello" } }] } }] }],
  };
}

async function runUnknownWebhook(): Promise<boolean> {
  const previousQueueEnabled = env.whatsappInboundQueueEnabled;
  const producer = { jobs: [] as WhatsAppInboundJobInputData[], enqueueInboundJob: async (data: WhatsAppInboundJobInputData) => { producer.jobs.push(data); return { ok: true as const, duplicate: false, jobId: data.messageId }; } };
  try {
    env.whatsappInboundQueueEnabled = true;
    setWhatsAppInboundProducerProviderForTesting(() => producer as unknown as WhatsAppInboundProducerService);
    setCloudWebhookProcessorForTesting(async () => ({ ok: true, handled: false, actionsCount: 0, sendAttempted: false, sendSuccess: false, outboundMessages: [] }));
    setWhatsAppActiveConnectionResolverForTesting(async () => null);
    const { response, finished } = fakeResponse();
    await receiveWhatsAppCloudWebhook(fakeRequest(webhookBody("999999999999999")), response);
    const result = await finished;
    return result.status === 200 && producer.jobs.length === 0;
  } finally {
    env.whatsappInboundQueueEnabled = previousQueueEnabled;
    setWhatsAppInboundProducerProviderForTesting(undefined);
    setCloudWebhookProcessorForTesting(undefined);
    setWhatsAppActiveConnectionResolverForTesting(undefined);
  }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11J imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);
  setWhatsAppConnectionOperationalRecorderForTesting({
    recordAudit: (name, payload) => events.push({ type: "audit", name, payload }),
    increment: (name, payload) => events.push({ type: "metric", name, payload: payload ?? { timestamp: new Date().toISOString() } }),
    observe: (name, value, payload) => events.push({ type: "observation", name, value, payload: payload ?? { timestamp: new Date().toISOString() } }),
  });

  const tenant = createTenantContext("seller_phase11j");
  const repository = new FakeRepository();
  const completion = new EmbeddedSignupCompletionService(repository, fakeCredentialService(), new FakeMetaTransport(), validateMetaEmbeddedSignupConfiguration({ appId: "app_phase11j", appSecret: "app_secret_should_not_emit", graphApiVersion: "v25.0" }));
  const completed = await completion.complete(tenant, { code: "exchange_code_secret", wabaId: "333333333333333", phoneNumberId: "444444444444444" });
  add("signup completion emits safe audit and duration metric", events.some((event) => event.name === "whatsapp_connection.signup_completed" && event.payload.connectionId === completed.connection.connectionId) && events.some((event) => event.name === "whatsapp_connection_signup_completion_duration"));

  await repository.persistFinalizationProgress(tenant, completed.connection.connectionId, { phoneRegistrationCompletedAt: new Date(), wabaSubscriptionCompletedAt: new Date() });
  const finalization = new WhatsAppConnectionFinalizationService(repository, fakeCredentialService(), new FakeMetaTransport());
  const activated = await finalization.activateReadyConnection(tenant, completed.connection.connectionId);
  add("activation emits safe audit event", activated.connection.status === "ACTIVE" && events.some((event) => event.name === "whatsapp_connection.activated"));

  const replacement = await completion.complete(tenant, { code: "replacement_code_secret", wabaId: "333333333333333", phoneNumberId: "555555555555555" });
  add("replacement start emits safe audit event", replacement.connection.status === "REPLACEMENT_PENDING" && events.some((event) => event.name === "whatsapp_connection.replacement_started"));

  const disconnect = new WhatsAppConnectionDisconnectService(repository);
  await disconnect.disconnect(tenant, completed.connection.connectionId);
  add("disconnect emits safe audit event", events.some((event) => event.name === "whatsapp_connection.disconnected" && event.payload.connectionId === completed.connection.connectionId));

  const healthRepo = new FakeRepository();
  healthRepo.connections.push(
    connection({ connectionId: "healthy", sellerId: "seller_h_active", status: "ACTIVE", lastVerifiedAt: new Date() }),
    connection({ connectionId: "verifying", sellerId: "seller_h_verifying", status: "VERIFYING" }),
    connection({ connectionId: "error", sellerId: "seller_h_error", status: "ERROR", finalizationLastErrorCode: "meta_permission_denied" }),
    connection({ connectionId: "disconnected", sellerId: "seller_h_disconnected", status: "DISCONNECTED", disconnectedAt: new Date() }),
    connection({ connectionId: "revoked", sellerId: "seller_h_revoked", status: "REVOKED" }),
  );
  const current = new WhatsAppConnectionCurrentService(healthRepo);
  add("safe health derivation covers ACTIVE, VERIFYING, ERROR, DISCONNECTED, and REVOKED",
    (await current.getCurrent(createTenantContext("seller_h_active"))).connection?.healthStatus === "HEALTHY" &&
    (await current.getCurrent(createTenantContext("seller_h_verifying"))).connection?.healthStatus === "SETUP_IN_PROGRESS" &&
    (await current.getCurrent(createTenantContext("seller_h_error"))).connection?.healthStatus === "ACTION_REQUIRED" &&
    (await current.getCurrent(createTenantContext("seller_h_disconnected"))).connection?.healthStatus === "DISCONNECTED" &&
    (await current.getCurrent(createTenantContext("seller_h_revoked"))).connection?.healthStatus === "REVOKED");
  add("bounded safeIssueCode behavior", (await current.getCurrent(createTenantContext("seller_h_error"))).connection?.safeIssueCode === "META_PERMISSION_REQUIRED");

  add("missing Meta config fails safely", await expectsError(
    () => new EmbeddedSignupCompletionService(repository, fakeCredentialService(), new FakeMetaTransport(), null).complete(tenant, { code: "secret", wabaId: "333333333333333", phoneNumberId: "666666666666666" }),
    (error) => error instanceof WhatsAppConnectionMetaConfigurationError,
  ));
  add("missing encryption config fails safely", await expectsError(
    () => new EmbeddedSignupCompletionService(repository, null, new FakeMetaTransport(), validateMetaEmbeddedSignupConfiguration({ appId: "app_phase11j", appSecret: "secret", graphApiVersion: "v25.0" })).complete(tenant, { code: "secret", wabaId: "333333333333333", phoneNumberId: "777777777777777" }),
    (error) => error instanceof WhatsAppConnectionCredentialEncryptionError,
  ));

  const tokenFailureRepo = new FakeRepository();
  tokenFailureRepo.connections.push(connection({ connectionId: "token_failure", sellerId: tenant.sellerId, status: "VERIFYING", wabaId: "333333333333333", phoneNumberId: "888888888888888", phoneRegistrationCompletedAt: new Date(), wabaSubscriptionCompletedAt: new Date() }));
  add("token decryption failure emits safe operational classification", await expectsError(
    () => new WhatsAppConnectionFinalizationService(tokenFailureRepo, fakeCredentialService({ throwDecrypt: true }), new FakeMetaTransport()).activateReadyConnection(tenant, "token_failure"),
    (error) => error instanceof WhatsAppConnectionFinalizationAccessDeniedError,
  ) && events.some((event) => event.name === "whatsapp_connection.token_invalid" && event.payload.reason === "credential_decryption_failed"));

  const outboundRepo = new FakeRepository();
  outboundRepo.connections.push(connection({ connectionId: "outbound_active", sellerId: tenant.sellerId, status: "ACTIVE", phoneNumberId: "999999999999999" }));
  add("outbound token failure emits safe metric", await expectsError(
    () => new PersistentWhatsAppOutboundConnectionResolver(outboundRepo, fakeCredentialService({ throwDecrypt: true })).resolveForTrustedSeller(tenant.sellerId),
    (error) => error instanceof WhatsAppOutboundError && error.category === "credential_decryption_failed",
  ) && events.some((event) => event.name === "whatsapp_connection_outbound_resolution_failures_total"));

  add("unknown phone webhook emits sanitized audit and metric event only", await runUnknownWebhook() && events.some((event) => event.name === "whatsapp_connection.unknown_phone_webhook") && events.some((event) => event.name === "whatsapp_connection_unknown_phone_webhooks_total"));

  const routeSource = await readFile(path.resolve(process.cwd(), "src/modules/whatsapp-connection/whatsapp-connection.routes.ts"), "utf8");
  add("rate limits applied to management mutations", (routeSource.match(/rateLimitAuth/gu) ?? []).length >= 3 && /embedded-signup\/complete/.test(routeSource) && /disconnect/.test(routeSource));
  add("AGENT and VIEWER cannot manage while OWNER and ADMIN can", !roleHasPermission("AGENT", "whatsapp_connection.manage") && !roleHasPermission("VIEWER", "whatsapp_connection.manage") && roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage"));

  const publicJson = JSON.stringify([completed, activated, await new WhatsAppConnectionCurrentService(repository).getCurrent(tenant)]);
  const eventJson = JSON.stringify(events);
  const forbidden = /token_phase11j_secret|runtime_token_secret|exchange_code_secret|replacement_code_secret|app_secret_should_not_emit|fingerprint_secret|encrypted_envelope|encrypted_pin_secret|pin_fingerprint_secret|entry|messages|text/i;
  add("public responses remain credential-free", !forbidden.test(publicJson));
  add("audit and metric payloads contain no secrets or raw payloads", !forbidden.test(eventJson));

  setWhatsAppConnectionOperationalRecorderForTesting(undefined);
  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  setWhatsAppConnectionOperationalRecorderForTesting(undefined);
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11J security audit health test failed safely." })}\n`);
  process.exitCode = 1;
});
