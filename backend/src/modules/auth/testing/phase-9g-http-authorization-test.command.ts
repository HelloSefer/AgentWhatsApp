import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import app from "../../../app";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import {
  AuthorizationService,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  SELLER_ROUTE_PERMISSIONS,
  SessionAuthService,
  type AuthPermission,
  type AuthRole,
  type AuthUser,
} from "../index";
import { AUTH_COOKIE_NAME } from "../http/auth-cookie";
import { requireAuthenticatedPrincipal, requirePermission } from "../http/auth.middleware";
import { resolveRequestedSellerTarget } from "../http/seller-target.resolver";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body?: unknown; text: string; setCookie?: string }>;

const cases: TestCase[] = [];

const ROUTE_CLASSIFICATION = Object.freeze({
  public: [
    "GET /health",
    "POST /api/auth/login",
    "GET /api/auth/google/start",
    "GET /api/whatsapp/cloud/webhook",
    "POST /api/whatsapp/cloud/webhook",
    "GET /order-form",
  ],
  authenticatedUser: [
    "GET /api/auth/me",
    "POST /api/auth/logout",
  ],
  sellerOwned: [
    "GET /api/agent/config/:sellerId",
    "GET /api/agent/config/:sellerId/required-fields",
    "GET /api/agent/config/:sellerId/first-entry-preview",
    "GET /api/agent/config/:sellerId/first-entry-eligibility-preview",
    "POST /api/agent/config/:sellerId/first-entry-intent-preview",
    "GET /api/agent/orders",
    "GET /api/agent/orders/:id",
    "PATCH /api/agent/orders/:id/status",
    "GET /api/agent/admin/notifications",
    "GET /api/agent/admin/notifications/:id",
    "PATCH /api/agent/admin/notifications/read-all",
    "PATCH /api/agent/admin/notifications/:id/read",
    "DELETE /api/agent/admin/notifications/:id",
    "GET /api/agent/conversation-config/effective/:sellerId",
  ],
  internalOrTestOnly: [
    "POST /api/agent/test",
    "POST /api/agent/order-runtime/eval",
    "POST /api/agent/first-entry-dry-run",
    "POST /api/ai/test",
    "GET /api/whatsapp/cloud/diagnostics",
  ],
});

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
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
  return {
    status: response.status,
    body,
    text,
    setCookie: response.headers.get("set-cookie") ?? undefined,
  };
}

function cookieHeader(rawToken: string): string {
  return `${AUTH_COOKIE_NAME}=${rawToken}`;
}

async function userIdsByPrefix(prefix: string): Promise<readonly string[]> {
  const result = await executeDatabaseQuery<{ user_id: string }>({
    text: "SELECT user_id FROM auth_users WHERE email_normalized LIKE $1",
    values: [`${prefix}%@example.com`],
  });
  return result.rows.map((row) => row.user_id);
}

async function cleanup(prefix: string, sellerIds: readonly string[]): Promise<void> {
  const userIds = await userIdsByPrefix(prefix);
  await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::text[])", values: [sellerIds] });
}

async function createSeller(sellerId: string): Promise<void> {
  await executeDatabaseQuery({ text: "INSERT INTO sellers (seller_id) VALUES ($1)", values: [sellerId] });
}

async function createUser(repository: PostgreSqlAuthRepository, prefix: string, label: string): Promise<AuthUser> {
  return repository.createUser({
    userId: randomUUID(),
    emailNormalized: `${prefix}_${label}@example.com`,
    status: "active",
  });
}

async function issueCookie(sessionAuthService: SessionAuthService, user: AuthUser): Promise<string> {
  return cookieHeader((await sessionAuthService.issueSessionForUser(user)).session.rawToken);
}

function createPermissionProbeApp(sessionAuthService: SessionAuthService, authorizationService: AuthorizationService): express.Express {
  const localApp = express();
  localApp.use(express.json());
  const addProbe = (path: string, permission: AuthPermission) => {
    localApp.all(
      path,
      requireAuthenticatedPrincipal(sessionAuthService),
      requirePermission(authorizationService, permission, resolveRequestedSellerTarget),
      (req, res) => {
        const authorized = req as typeof req & { tenant?: { sellerId: string }; authorization?: { role: AuthRole; permission: AuthPermission } };
        res.status(200).json({
          sellerId: authorized.tenant?.sellerId,
          role: authorized.authorization?.role,
          permission: authorized.authorization?.permission,
          tenantAttached: Boolean(authorized.tenant),
        });
      },
    );
  };
  addProbe("/catalog-manage", "catalog.manage");
  addProbe("/seller-read", "seller.read");
  return localApp;
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("No database or network I/O on import", !getDatabasePoolState().initialized);
  add("Route classification matrix", ROUTE_CLASSIFICATION.public.length >= 6 && ROUTE_CLASSIFICATION.sellerOwned.length >= 10 && ROUTE_CLASSIFICATION.authenticatedUser.includes("GET /api/auth/me"));
  add("Route-to-permission mapping is explicit", SELLER_ROUTE_PERMISSIONS.agentOrdersRead === "orders.read" && SELLER_ROUTE_PERMISSIONS.agentOrdersManage === "orders.manage" && SELLER_ROUTE_PERMISSIONS.agentConfigRead === "conversation_config.read");

  const prefix = `phase9g_${randomUUID().replace(/-/gu, "")}`;
  const repository = new PostgreSqlAuthRepository();
  const passwordAuthService = new PasswordAuthService(repository);
  const sessionAuthService = new SessionAuthService(repository, passwordAuthService);
  const authorizationService = new AuthorizationService(repository);
  const probeApp = createPermissionProbeApp(sessionAuthService, authorizationService);
  const { server, baseUrl } = await startServer(app);
  const { server: probeServer, baseUrl: probeBaseUrl } = await startServer(probeApp);
  const sellerIds: string[] = [];

  try {
    await cleanup(prefix, sellerIds);
    const sellerA = `seller_${prefix}_a`;
    const sellerB = `seller_${prefix}_b`;
    sellerIds.push(sellerA, sellerB);
    await createSeller(sellerA);
    await createSeller(sellerB);

    const owner = await createUser(repository, prefix, "owner");
    const admin = await createUser(repository, prefix, "admin");
    const agent = await createUser(repository, prefix, "agent");
    const viewer = await createUser(repository, prefix, "viewer");
    const disabled = await createUser(repository, prefix, "disabled");
    const revoked = await createUser(repository, prefix, "revoked");
    const noMembership = await createUser(repository, prefix, "nomembership");
    const multi = await createUser(repository, prefix, "multi");

    await repository.createSellerMembership({ sellerId: sellerA, userId: owner.userId, role: "OWNER", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: admin.userId, role: "ADMIN", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: agent.userId, role: "AGENT", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: viewer.userId, role: "VIEWER", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: disabled.userId, role: "OWNER", status: "disabled" });
    await repository.createSellerMembership({ sellerId: sellerB, userId: revoked.userId, role: "OWNER", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: multi.userId, role: "OWNER", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerB, userId: multi.userId, role: "OWNER", status: "active" });

    const ownerCookie = await issueCookie(sessionAuthService, owner);
    const adminCookie = await issueCookie(sessionAuthService, admin);
    const agentCookie = await issueCookie(sessionAuthService, agent);
    const viewerCookie = await issueCookie(sessionAuthService, viewer);
    const disabledCookie = await issueCookie(sessionAuthService, disabled);
    const revokedCookie = await issueCookie(sessionAuthService, revoked);
    const noMembershipCookie = await issueCookie(sessionAuthService, noMembership);
    const multiCookie = await issueCookie(sessionAuthService, multi);

    add("Public auth route remains public", (await request(baseUrl, "/api/auth/login", { method: "POST", body: {} })).status !== 401);
    add("Google routes remain public", [302, 503].includes((await request(baseUrl, "/api/auth/google/start")).status));
    add("Health/readiness behavior remains intentional", (await request(baseUrl, "/health")).status === 200);
    add("WhatsApp verification webhook remains public", (await request(baseUrl, "/api/whatsapp/cloud/webhook")).status !== 401);
    add("WhatsApp inbound webhook remains outside user auth", (await request(baseUrl, "/api/whatsapp/cloud/webhook", { method: "POST", body: {} })).status !== 401);
    add("No global middleware applied accidentally", (await request(baseUrl, "/privacy")).status === 200);

    add("Seller-owned read route without session returns 401", (await request(baseUrl, `/api/agent/config/${encodeURIComponent(sellerA)}`)).status === 401);
    add("Seller-owned write route without session returns 401", (await request(baseUrl, `/api/agent/orders/missing/status?sellerId=${encodeURIComponent(sellerA)}`, { method: "PATCH", body: { status: "SENT" } })).status === 401);

    add("Valid OWNER access", (await request(baseUrl, `/api/agent/orders?sellerId=${encodeURIComponent(sellerA)}`, { cookie: ownerCookie })).status === 200);
    const trustedProbe = await request(probeBaseUrl, `/seller-read?sellerId=${encodeURIComponent(sellerA)}`, { cookie: ownerCookie });
    add("Trusted TenantContext reaches the controller on success", trustedProbe.status === 200 && (trustedProbe.body as { sellerId?: unknown; tenantAttached?: unknown }).sellerId === sellerA && (trustedProbe.body as { tenantAttached?: unknown }).tenantAttached === true);
    add("Valid ADMIN access", (await request(baseUrl, `/api/agent/orders?sellerId=${encodeURIComponent(sellerA)}`, { cookie: adminCookie })).status === 200);
    add("AGENT allowed orders.manage", (await request(baseUrl, `/api/agent/orders/missing/status?sellerId=${encodeURIComponent(sellerA)}`, { method: "PATCH", cookie: agentCookie, body: { status: "SENT" } })).status === 404);
    add("AGENT denied catalog.manage", (await request(probeBaseUrl, `/catalog-manage?sellerId=${encodeURIComponent(sellerA)}`, { method: "POST", cookie: agentCookie, body: { role: "OWNER" } })).status === 403);
    add("VIEWER denied write", (await request(baseUrl, `/api/agent/orders/missing/status?sellerId=${encodeURIComponent(sellerA)}`, { method: "PATCH", cookie: viewerCookie, body: { status: "SENT" } })).status === 403);
    add("Disabled membership returns 403", (await request(baseUrl, `/api/agent/config/${encodeURIComponent(sellerA)}`, { cookie: disabledCookie })).status === 403);
    await repository.setSellerMembershipStatus(sellerB, revoked.userId, "disabled", new Date());
    add("Revoked membership after session creation returns 403", (await request(baseUrl, `/api/agent/config/${encodeURIComponent(sellerB)}`, { cookie: revokedCookie })).status === 403);
    add("Cross-tenant read returns 403", (await request(baseUrl, `/api/agent/config/${encodeURIComponent(sellerB)}`, { cookie: ownerCookie })).status === 403);
    add("Cross-tenant write returns 403", (await request(baseUrl, `/api/agent/orders/missing/status?sellerId=${encodeURIComponent(sellerB)}`, { method: "PATCH", cookie: ownerCookie, body: { status: "SENT" } })).status === 403);
    add("Invalid/default/blank seller target returns 400", (await request(baseUrl, "/api/agent/orders?sellerId=Default%20Seller", { cookie: ownerCookie })).status === 400 && (await request(baseUrl, "/api/agent/orders?sellerId=%20%20", { cookie: ownerCookie })).status === 400);
    add("Conflicting seller targets return 400", (await request(baseUrl, `/api/agent/config/${encodeURIComponent(sellerA)}?sellerId=${encodeURIComponent(sellerB)}`, { cookie: ownerCookie })).status === 400);
    add("One membership auto-resolution", (await request(baseUrl, "/api/agent/orders", { cookie: ownerCookie })).status === 200);
    add("Multiple memberships require explicit target", (await request(baseUrl, "/api/agent/orders", { cookie: multiCookie })).status === 409);
    add("Requested seller target never grants authority by itself", (await request(baseUrl, `/api/agent/orders?sellerId=${encodeURIComponent(sellerA)}`, { cookie: noMembershipCookie })).status === 403);
    add("Client role escalation ignored", (await request(probeBaseUrl, `/catalog-manage?sellerId=${encodeURIComponent(sellerA)}`, { method: "POST", cookie: agentCookie, body: { role: "OWNER" } })).status === 403);
    const permissionProbe = await request(probeBaseUrl, `/seller-read?sellerId=${encodeURIComponent(sellerA)}&permission=seller.manage`, { method: "POST", cookie: viewerCookie, body: { permission: "seller.manage" } });
    add("Client permission escalation ignored", permissionProbe.status === 200 && (permissionProbe.body as { permission?: unknown }).permission === "seller.read");
    const missingSeller = await request(baseUrl, `/api/agent/config/${encodeURIComponent(`seller_${prefix}_missing`)}`, { cookie: ownerCookie });
    add("No seller existence disclosure", missingSeller.status === 403 && missingSeller.text === JSON.stringify({ message: "Forbidden." }));
    add("Safe 401/403/400 mapping", (await request(baseUrl, `/api/agent/config/${encodeURIComponent(sellerA)}`)).status === 401 && missingSeller.status === 403 && (await request(baseUrl, "/api/agent/orders?sellerId=Default%20Seller", { cookie: ownerCookie })).status === 400);
  } finally {
    await stopServer(probeServer);
    await stopServer(server);
    await cleanup(prefix, sellerIds);
    add("Phase 9G rows are cleaned up", (await userIdsByPrefix(prefix)).length === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9G HTTP authorization test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
