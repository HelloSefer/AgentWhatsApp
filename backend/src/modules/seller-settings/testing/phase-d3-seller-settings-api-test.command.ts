import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import dotenv from "dotenv";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery } from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { PostgreSqlAuthRepository, PasswordAuthService, SessionAuthService, type AuthRole, type AuthUser } from "../../auth";
import { AUTH_COOKIE_NAME } from "../../auth/http/auth-cookie";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import { SellerCommerceConfigRepository, parseSellerCommerceConfig } from "../../seller-commerce-config";
import { setSellerSettingsOperationalRecorderForTesting } from "../application/seller-settings-operational-events";
import { SellerSettingsService } from "../application/seller-settings.service";
import { createSellerSettingsRoutes } from "../seller-settings.routes";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body: unknown; text: string; setCookie?: string }>;
type EventRecord = Readonly<{ name: string; payload: unknown }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];
const userIds: string[] = [];
const events: EventRecord[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function validCommerce(allowedSellerId: string) {
  return parseSellerCommerceConfig({
    configVersion: 1,
    payment: { method: "COD", enabled: true },
    delivery: {
      enabled: true,
      availability: "all_cities",
      pricing: {
        mode: "CITY_RULES",
        currency: "MAD",
        rules: [
          { id: "casablanca", type: "PAID", cityKeys: ["casablanca"], aliases: ["Casa"], amountMinor: 2000, priority: 1 },
          { id: "rabat", type: "FREE", cityKeys: ["rabat"], priority: 2 },
        ],
        defaultRule: { id: "default", type: "PAID", amountMinor: 3000 },
      },
    },
    requiredCustomerFields: [
      { key: "fullName", label: "Name", required: true, enabled: true, askOrder: 1 },
      { key: "phone", label: "Phone", required: true, enabled: true, askOrder: 2, captureMode: "PHONE" },
      { key: "city", label: "City", required: true, enabled: true, askOrder: 3 },
      { key: "address", label: "Address", required: true, enabled: true, askOrder: 4, captureMode: "ADDRESS" },
    ],
    orderBehavior: { multiItemOrderFlow: { enabled: true, runtimeMode: "guarded", allowedSellerIds: [allowedSellerId] } },
    receipt: { enabled: true, sendAfterConfirmation: true, showLogo: true, footerText: "Thanks", paymentMethodLabel: "COD" },
  });
}

function startServer(handler: RequestListener): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) throw new Error("Server address unavailable.");
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(baseUrl: string, path: string, input: Readonly<{ method?: string; body?: unknown; cookie?: string }> = {}): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text, setCookie: response.headers.get("set-cookie") ?? undefined };
}

function cookieHeader(rawToken: string): string {
  return `${AUTH_COOKIE_NAME}=${rawToken}`;
}

async function createSeller(sellerId: string, displayName: string): Promise<void> {
  await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerId) });
  await new PostgreSqlSellerWorkspaceProfileRepository().createProfile({ sellerId, displayName });
  sellerIds.push(sellerId);
}

async function createUser(repository: PostgreSqlAuthRepository, prefix: string, label: string): Promise<AuthUser> {
  const user = await repository.createUser({
    userId: randomUUID(),
    emailNormalized: `${prefix}_${label}@example.com`,
    status: "active",
  });
  userIds.push(user.userId);
  return user;
}

async function issueCookie(sessionAuthService: SessionAuthService, user: AuthUser): Promise<string> {
  return cookieHeader((await sessionAuthService.issueSessionForUser(user)).session.rawToken);
}

async function addMembership(repository: PostgreSqlAuthRepository, sellerId: string, userId: string, role: AuthRole): Promise<void> {
  await repository.createSellerMembership({ sellerId, userId, role, status: "active" });
}

async function cleanup(): Promise<void> {
  if (sellerIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_memberships WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  }
  if (userIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
  }
}

function createLocalApp(): express.Express {
  const localApp = express();
  const auth = createAuthComposition();
  const persistence = createPersistenceComposition();
  localApp.use(express.json());
  localApp.use("/api/seller", createSellerSettingsRoutes(auth, persistence));
  return localApp;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errors(value: unknown): readonly { field?: unknown; code?: unknown }[] {
  const record = bodyRecord(value);
  return Array.isArray(record.errors) ? record.errors as { field?: unknown; code?: unknown }[] : [];
}

async function persistedCommerceVersion(sellerId: string): Promise<number | undefined> {
  const result = await executeDatabaseQuery<{ version: number }>({
    text: "SELECT (config_json ->> 'configVersion')::int AS version FROM seller_commerce_configs WHERE seller_id = $1",
    values: [sellerId],
  });
  return result.rows[0]?.version;
}

async function main(): Promise<void> {
  await closeDatabasePool();
  setSellerSettingsOperationalRecorderForTesting({
    recordAudit: (name, payload) => events.push({ name, payload }),
  });

  const prefix = `phase_d3_${randomUUID().replace(/-/gu, "")}`;
  const repository = new PostgreSqlAuthRepository();
  const passwordAuthService = new PasswordAuthService(repository);
  const sessionAuthService = new SessionAuthService(repository, passwordAuthService);
  const commerceRepository = new SellerCommerceConfigRepository();
  const localApp = createLocalApp();
  const { server, baseUrl } = await startServer(localApp);

  try {
    const sellerA = id("seller_phase_d3_a");
    const sellerB = id("seller_phase_d3_b");
    const sellerMissingConfig = id("seller_phase_d3_missing_config");
    await createSeller(sellerA, "Atlas Store");
    await createSeller(sellerB, "Other Store");
    await createSeller(sellerMissingConfig, "Missing Config Store");
    await commerceRepository.save(createTenantContext(sellerA), validCommerce(sellerA));
    await commerceRepository.save(createTenantContext(sellerB), validCommerce(sellerB));

    const owner = await createUser(repository, prefix, "owner");
    const admin = await createUser(repository, prefix, "admin");
    const agent = await createUser(repository, prefix, "agent");
    const viewer = await createUser(repository, prefix, "viewer");
    const otherOwner = await createUser(repository, prefix, "other_owner");
    const missingOwner = await createUser(repository, prefix, "missing_owner");
    await addMembership(repository, sellerA, owner.userId, "OWNER");
    await addMembership(repository, sellerA, admin.userId, "ADMIN");
    await addMembership(repository, sellerA, agent.userId, "AGENT");
    await addMembership(repository, sellerA, viewer.userId, "VIEWER");
    await addMembership(repository, sellerB, otherOwner.userId, "OWNER");
    await addMembership(repository, sellerMissingConfig, missingOwner.userId, "OWNER");

    const ownerCookie = await issueCookie(sessionAuthService, owner);
    const adminCookie = await issueCookie(sessionAuthService, admin);
    const agentCookie = await issueCookie(sessionAuthService, agent);
    const viewerCookie = await issueCookie(sessionAuthService, viewer);
    const otherOwnerCookie = await issueCookie(sessionAuthService, otherOwner);
    const missingCookie = await issueCookie(sessionAuthService, missingOwner);

    const ownerRead = await request(baseUrl, "/api/seller/settings", { cookie: ownerCookie });
    const ownerReadBody = bodyRecord(ownerRead.body);
    add("OWNER can read seller settings", ownerRead.status === 200 && bodyRecord(ownerReadBody.store).businessName === "Atlas Store");
    add("ADMIN can read seller settings", (await request(baseUrl, "/api/seller/settings", { cookie: adminCookie })).status === 200);
    add("AGENT and VIEWER are rejected for settings read", (await request(baseUrl, "/api/seller/settings", { cookie: agentCookie })).status === 403 && (await request(baseUrl, "/api/seller/settings", { cookie: viewerCookie })).status === 403);
    add("Unauthenticated settings read is rejected", (await request(baseUrl, "/api/seller/settings")).status === 401);
    add("Read combines profile and commerce config", bodyRecord(ownerReadBody.store).businessName === "Atlas Store" && bodyRecord(ownerReadBody.commerce).payment !== undefined && bodyRecord(ownerReadBody.readiness).status === "READY");
    add("Read DTO exposes no raw JSONB, ids, workspace purpose or secrets", !/(sellerId|workspaceId|workspacePurpose|config_json|encrypted|credential|connectionId|wabaId|phoneNumberId)/i.test(ownerRead.text));

    const crossRead = await request(baseUrl, `/api/seller/settings?sellerId=${encodeURIComponent(sellerB)}`, { cookie: ownerCookie });
    add("Query sellerId cannot switch read tenant", crossRead.status === 200 && bodyRecord(bodyRecord(crossRead.body).store).businessName === "Atlas Store");
    add("Tenant B owner reads only Tenant B", bodyRecord(bodyRecord((await request(baseUrl, "/api/seller/settings", { cookie: otherOwnerCookie })).body).store).businessName === "Other Store");
    const missingRead = await request(baseUrl, "/api/seller/settings", { cookie: missingCookie });
    add("Missing config returns bounded not-ready response", missingRead.status === 200 && bodyRecord(bodyRecord(missingRead.body).readiness).status === "SELLER_COMMERCE_CONFIG_REQUIRED" && !("commerce" in bodyRecord(missingRead.body)));

    const canonicalUpdate = {
      store: {
        businessName: "  Atlas   Premium  ",
        locale: "ar-MA",
        contact: { intendedWhatsappPhoneE164: " +212 600-000-009 " },
        logo: { objectKey: `seller-logos/${sellerA}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`, mimeType: "image/png" },
      },
      commerce: {
        payment: { method: "COD", enabled: true },
        delivery: { enabled: true, availability: "all_cities", pricing: { mode: "FLAT_RATE", currency: "MAD", flatRateMinor: 2500 } },
        requiredCustomerFields: [
          { key: "fullName", label: "Name", required: true, enabled: true },
          { key: "phone", label: "Phone", required: true, enabled: true },
          { key: "city", label: "City", required: true, enabled: true },
          { key: "address", label: "Address", required: true, enabled: true },
        ],
        orderBehavior: { multiItemOrderFlow: { enabled: true, runtimeMode: "guarded" } },
        receipt: { enabled: true, sendAfterConfirmation: true, showLogo: true, footerText: "Merci", paymentMethodLabel: "Cash" },
      },
    };
    const ownerUpdate = await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: ownerCookie, body: canonicalUpdate });
    add("OWNER can update canonical seller settings", ownerUpdate.status === 200 && bodyRecord(bodyRecord(ownerUpdate.body).store).businessName === "Atlas Premium" && bodyRecord(bodyRecord(bodyRecord(ownerUpdate.body).store).contact).intendedWhatsappPhoneE164 === "+212600000009");
    add("ADMIN can update seller settings", (await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: adminCookie, body: { store: { businessName: "Atlas Admin" } } })).status === 200);
    add("AGENT and unauthenticated users cannot update", (await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: agentCookie, body: canonicalUpdate })).status === 403 && (await request(baseUrl, "/api/seller/settings", { method: "PUT", body: canonicalUpdate })).status === 401);
    add("Request sellerId/workspaceId cannot change target tenant", (await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: ownerCookie, body: { sellerId: sellerB, workspaceId: sellerB } })).status === 400 && bodyRecord(bodyRecord((await request(baseUrl, "/api/seller/settings", { cookie: ownerCookie })).body).store).businessName !== "Other Store");
    add("workspacePurpose cannot be changed", errors((await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: ownerCookie, body: { workspacePurpose: "DEVELOPMENT" } })).body).some((error) => error.field === "workspacePurpose"));

    const invalidCases: readonly [string, unknown, string][] = [
      ["Invalid payment mode rejected", { commerce: { ...canonicalUpdate.commerce, payment: { method: "CARD", enabled: true } } }, "UNSUPPORTED_PAYMENT_METHOD"],
      ["Invalid delivery rule rejected", { commerce: { ...canonicalUpdate.commerce, delivery: { enabled: true, availability: "all_cities", pricing: { mode: "CITY_RULES", currency: "MAD", rules: [{ id: "x", type: "MAYBE", cityKeys: ["x"] }] } } } }, "UNKNOWN_RULE_TYPE"],
      ["Negative minor-unit price rejected", { commerce: { ...canonicalUpdate.commerce, delivery: { enabled: true, availability: "all_cities", pricing: { mode: "FLAT_RATE", currency: "MAD", flatRateMinor: -1 } } } }, "INVALID_MINOR_UNITS"],
      ["Duplicate city rule rejected", { commerce: { ...canonicalUpdate.commerce, delivery: { enabled: true, availability: "all_cities", pricing: { mode: "CITY_RULES", currency: "MAD", rules: [{ id: "a", type: "PAID", cityKeys: ["rabat"], amountMinor: 1 }, { id: "b", type: "FREE", cityKeys: ["rabat"] }] } } } }, "DUPLICATE_CITY_RULE"],
      ["Duplicate required field rejected", { commerce: { ...canonicalUpdate.commerce, requiredCustomerFields: [{ key: "phone", label: "Phone", required: true, enabled: true }, { key: "phone", label: "Phone", required: true, enabled: true }] } }, "DUPLICATE_FIELD_KEY"],
      ["Unsupported field key rejected", { commerce: { ...canonicalUpdate.commerce, requiredCustomerFields: [{ key: "customUnsafe", label: "Custom", required: true, enabled: true }] } }, "UNSUPPORTED_FIELD_KEY"],
      ["Unsupported configVersion input rejected", { configVersion: 2, commerce: canonicalUpdate.commerce }, "FORBIDDEN_PROPERTY"],
      ["Product/conversation/credential fields rejected", { products: [], conversationConfig: {}, credentials: {} }, "FORBIDDEN_PROPERTY"],
      ["Unknown unsafe properties rejected", { store: { businessName: "Ok", unsafe: true } }, "UNKNOWN_PROPERTY"],
      ["Tenant A cannot inject Tenant B media references", { store: { logo: { objectKey: `seller-logos/${sellerB}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`, mimeType: "image/png" } } }, "UNTRUSTED_MEDIA_REFERENCE"],
    ];
    for (const [name, body, code] of invalidCases) {
      const response = await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: ownerCookie, body });
      add(name, response.status === 400 && errors(response.body).some((error) => error.code === code));
    }

    const beforeAtomic = await new PostgreSqlSellerWorkspaceProfileRepository().findByTenantContext(createTenantContext(sellerA));
    const failedAtomic = await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: ownerCookie, body: { store: { businessName: "Partial Should Roll Back" }, commerce: { ...canonicalUpdate.commerce, payment: { method: "WIRE", enabled: true } } } });
    const afterAtomic = await new PostgreSqlSellerWorkspaceProfileRepository().findByTenantContext(createTenantContext(sellerA));
    add("Invalid multi-authority write rolls back profile changes", failedAtomic.status === 400 && beforeAtomic?.displayName === afterAtomic?.displayName);
    const noop = await request(baseUrl, "/api/seller/settings", { method: "PUT", cookie: ownerCookie, body: {} });
    add("No-op update remains idempotent and ready", noop.status === 200 && bodyRecord(bodyRecord(noop.body).readiness).status === "READY");
    add("Seller Commerce Config configVersion remains 1", await persistedCommerceVersion(sellerA) === 1);
    add("Successful update emits safe audit event", events.some((event) => event.name === "seller_settings.updated" && JSON.stringify(event.payload).includes("OWNER")));
    add("Audit logs contain no request payload, phone, address or secret material", !/(212600000009|Partial Should Roll Back|credentials|encrypted|address)/i.test(JSON.stringify(events)));

    const developmentTenant = await executeDatabaseQuery<{ seller_id: string }>({
      text: "SELECT seller_id FROM sellers WHERE workspace_purpose = 'DEVELOPMENT' ORDER BY seller_id ASC",
      values: [],
    });
    const developmentSettingsService = new SellerSettingsService(new PostgreSqlSellerWorkspaceProfileRepository());
    const developmentNoop = developmentTenant.rows.length === 1
      ? await developmentSettingsService.update(createTenantContext(developmentTenant.rows[0]!.seller_id), {}, { role: "OWNER" })
      : undefined;
    add("Development Tenant remains READY after read/no-op update cycle", developmentNoop?.settings.readiness.status === "READY");

    const [routesSource, serviceSource, appSource] = await Promise.all([
      readFile("src/modules/seller-settings/seller-settings.routes.ts", "utf8"),
      readFile("src/modules/seller-settings/application/seller-settings.service.ts", "utf8"),
      readFile("src/app.ts", "utf8"),
    ]);
    add("Single authoritative route exposes GET and PUT only", routesSource.includes('router.get("/settings"') && routesSource.includes('router.put("/settings"') && !routesSource.includes("sellerId"));
    add("Seller Settings service does not update products, conversation config or credentials", !/(Catalog|ConversationConfig|whatsapp_connections|credentials|products)/.test(serviceSource));
    add("App mounts seller settings without frontend changes", appSource.includes('/api/seller", sellerSettingsRoutes'));
  } finally {
    await stopServer(server);
    await cleanup();
    await closeDatabasePool();
    setSellerSettingsOperationalRecorderForTesting(undefined);
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  setSellerSettingsOperationalRecorderForTesting(undefined);
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase D3 seller settings API test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
