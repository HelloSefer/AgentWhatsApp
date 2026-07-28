import type { Request, Response } from "express";
import { closeDatabasePool, createTenantContext, getDatabasePoolState, type TenantContext } from "../../../infrastructure/database";
import { roleHasPermission } from "../../auth";
import { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import type { WhatsAppConnectionFinalizationProgressInput, WhatsAppConnectionRepository, VerifiedWhatsAppConnectionMetadataInput } from "../contracts/whatsapp-connection.repository";
import type {
  PersistWhatsAppConnectionCredentialInput,
  PersistWhatsAppConnectionRegistrationPinInput,
  WhatsAppConnectionCredentialStorage,
  WhatsAppConnectionRegistrationPinStorage,
} from "../domain/whatsapp-connection-credentials.types";
import type { ActiveWhatsAppConnectionResolution, WhatsAppConnection, WhatsAppConnectionStatus } from "../domain/whatsapp-connection.types";
import { WhatsAppConnectionController } from "../http/whatsapp-connection.controller";

type TestCase = Readonly<{ name: string; passed: boolean }>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
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

  async createCandidate(tenant: TenantContext): Promise<WhatsAppConnection> {
    const candidate = connection({ connectionId: `conn_${tenant.sellerId}`, sellerId: tenant.sellerId, status: "PENDING" });
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

  async markReplacementPending(tenant: TenantContext, connectionId: string, replacedConnectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current) return null;
    const updated = { ...current, status: "REPLACEMENT_PENDING" as const, replacedConnectionId, updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async replaceActiveConnection(): Promise<WhatsAppConnection | null> {
    return null;
  }

  async disconnectActiveConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection | null> {
    const current = await this.findByConnectionId(tenant, connectionId);
    if (!current || current.status !== "ACTIVE") return null;
    const updated = { ...current, status: "DISCONNECTED" as const, disconnectedAt: new Date(), updatedAt: new Date() };
    this.replace(updated);
    return updated;
  }

  async persistVerifiedMetadata(): Promise<WhatsAppConnection | null> {
    return null;
  }

  async persistAccessTokenCredential(): Promise<WhatsAppConnectionCredentialStorage | null> {
    return null;
  }

  async findCredentialStorage(): Promise<WhatsAppConnectionCredentialStorage | null> {
    return null;
  }

  async persistRegistrationPinCredential(): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    return null;
  }

  async findRegistrationPinStorage(): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    return null;
  }

  async persistFinalizationProgress(): Promise<WhatsAppConnection | null> {
    return null;
  }

  async activateConnection(): Promise<WhatsAppConnection | null> {
    return null;
  }

  private replace(updated: WhatsAppConnection): void {
    this.connections = this.connections.map((entry) => entry.connectionId === updated.connectionId ? updated : entry);
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

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Phase 11I imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const tenant = createTenantContext("seller_phase11i_a");
  const otherTenant = createTenantContext("seller_phase11i_b");
  const repository = new FakeRepository();
  const service = new WhatsAppConnectionCurrentService(repository);

  add("no connection returns null", (await service.getCurrent(tenant)).connection === null);

  repository.connections.push(
    connection({
      connectionId: "conn_disconnected",
      sellerId: tenant.sellerId,
      status: "DISCONNECTED",
      displayPhoneNumber: "+212 600 000 001",
      phoneNumberId: "111111111111111",
      wabaId: "222222222222222",
      disconnectedAt: new Date("2026-07-27T12:00:00.000Z"),
    }),
    connection({
      connectionId: "conn_active",
      sellerId: tenant.sellerId,
      status: "ACTIVE",
      displayPhoneNumber: "+212 600 000 999",
      verifiedName: "Atlas Shop",
      connectedAt: new Date("2026-07-28T10:00:00.000Z"),
      lastVerifiedAt: new Date("2026-07-28T11:00:00.000Z"),
      phoneNumberId: "333333333333333",
      wabaId: "444444444444444",
      metaBusinessId: "555555555555555",
    }),
    connection({
      connectionId: "conn_other",
      sellerId: otherTenant.sellerId,
      status: "ACTIVE",
      displayPhoneNumber: "+212 600 000 123",
      verifiedName: "Other Seller",
    }),
  );

  const active = await service.getCurrent(tenant);
  add("authenticated seller sees only their current connection", active.connection?.connectionId === "conn_active" && active.connection.verifiedName === "Atlas Shop");
  add("ACTIVE preferred over historical disconnected rows", active.connection?.status === "ACTIVE");
  add("another seller's data never appears", !JSON.stringify(active).includes("Other Seller") && (await service.getCurrent(otherTenant)).connection?.connectionId === "conn_other");
  add("safe response masks phone number", active.connection?.maskedPhoneNumber === "••••••••0999");
  add("response excludes credential and internal Meta fields", !/token|encrypted|fingerprint|pin|waba|phoneNumberId|phone_number_id|metaBusinessId|333333333333333|444444444444444|555555555555555/i.test(JSON.stringify(active)));

  const inProgressRepository = new FakeRepository();
  inProgressRepository.connections.push(
    connection({ connectionId: "conn_pending", sellerId: tenant.sellerId, status: "PENDING", createdAt: new Date("2026-07-28T09:00:00.000Z") }),
    connection({ connectionId: "conn_verifying", sellerId: tenant.sellerId, status: "VERIFYING", createdAt: new Date("2026-07-28T08:00:00.000Z") }),
  );
  add("in-progress candidate returned safely when no ACTIVE exists", (await new WhatsAppConnectionCurrentService(inProgressRepository).getCurrent(tenant)).connection?.connectionId === "conn_verifying");

  const replacementRepository = new FakeRepository();
  replacementRepository.connections.push(connection({
    connectionId: "conn_replacement",
    sellerId: tenant.sellerId,
    status: "REPLACEMENT_PENDING",
    replacedConnectionId: "conn_old",
    displayPhoneNumber: "+212 600 000 777",
  }));
  const replacement = await new WhatsAppConnectionCurrentService(replacementRepository).getCurrent(tenant);
  add("replacement candidate is marked without exposing old connection authority", replacement.connection?.isReplacement === true && !JSON.stringify(replacement).includes("conn_old"));

  const controller = new WhatsAppConnectionController({} as never, service);
  const res = responseProbe();
  await controller.getCurrentConnection({ tenant, query: { sellerId: otherTenant.sellerId } } as unknown as Request, res as Response);
  add("controller ignores browser sellerId and uses TenantContext", res.statusCode === 200 && (res.body as { connection?: { connectionId?: string } }).connection?.connectionId === "conn_active");

  add("OWNER and ADMIN may manage WhatsApp connections", roleHasPermission("OWNER", "whatsapp_connection.manage") && roleHasPermission("ADMIN", "whatsapp_connection.manage"));
  add("AGENT may view but cannot manage", roleHasPermission("AGENT", "whatsapp_connection.read") && !roleHasPermission("AGENT", "whatsapp_connection.manage"));
  add("management permission required for disconnect", !roleHasPermission("AGENT", "whatsapp_connection.manage"));

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11I management API test failed safely." })}\n`);
  process.exitCode = 1;
});
