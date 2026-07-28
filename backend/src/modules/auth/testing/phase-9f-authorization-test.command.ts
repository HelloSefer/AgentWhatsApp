import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import app from "../../../app";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import {
  AUTH_PERMISSIONS,
  AuthorizationInsufficientPermissionError,
  AuthorizationInvalidSellerTargetError,
  AuthorizationNoActiveMembershipError,
  AuthorizationService,
  AuthorizationTenantSelectionRequiredError,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  ROLE_PERMISSIONS,
  SessionAuthService,
  roleHasPermission,
  type AuthPermission,
  type AuthRole,
  type AuthUser,
} from "../index";
import { AUTH_COOKIE_NAME } from "../http/auth-cookie";
import { requireAuthenticatedPrincipal, requirePermission } from "../http/auth.middleware";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body?: unknown; text: string; setCookie?: string }>;

const cases: TestCase[] = [];

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
    text,
    body,
    setCookie: response.headers.get("set-cookie") ?? undefined,
  };
}

function cookieHeader(rawToken: string): string {
  return `${AUTH_COOKIE_NAME}=${rawToken}`;
}

async function expectsError(callback: () => Promise<unknown>, type: new () => Error): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof type;
  }
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
  const session = await sessionAuthService.issueSessionForUser(user);
  return cookieHeader(session.session.rawToken);
}

function createMiddlewareApp(sessionAuthService: SessionAuthService, authorizationService: AuthorizationService): express.Express {
  const localApp = express();
  localApp.use(express.json());
  const handler = [
    requireAuthenticatedPrincipal(sessionAuthService),
    requirePermission(authorizationService, "orders.manage", (req) => req.query.sellerId),
    (req: express.Request, res: express.Response) => {
      const authorized = req as typeof req & { tenant?: { sellerId: string }; authorization?: { role: AuthRole; permission: AuthPermission } };
      res.status(200).json({
        sellerId: authorized.tenant?.sellerId,
        role: authorized.authorization?.role,
        permission: authorized.authorization?.permission,
        tenantAttached: Boolean(authorized.tenant),
      });
    },
  ] as const;
  localApp.get("/protected", ...handler);
  localApp.post("/protected", ...handler);
  return localApp;
}

function matrixMatches(role: AuthRole, allowed: readonly AuthPermission[]): boolean {
  const allowedSet = new Set(allowed);
  return AUTH_PERMISSIONS.every((permission) => roleHasPermission(role, permission) === allowedSet.has(permission)) &&
    ROLE_PERMISSIONS[role].every((permission) => AUTH_PERMISSIONS.includes(permission));
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Auth authorization imports do not initialize database pool", !getDatabasePoolState().initialized);

  const prefix = `phase9f_${randomUUID().replace(/-/gu, "")}`;
  const repository = new PostgreSqlAuthRepository();
  const passwordAuthService = new PasswordAuthService(repository);
  const sessionAuthService = new SessionAuthService(repository, passwordAuthService);
  const authorizationService = new AuthorizationService(repository);
  const middlewareApp = createMiddlewareApp(sessionAuthService, authorizationService);
  const { server, baseUrl } = await startServer(middlewareApp);
  const sellerIds: string[] = [];

  try {
    await cleanup(prefix, sellerIds);

    add("OWNER permission matrix", matrixMatches("OWNER", AUTH_PERMISSIONS));
    add("ADMIN permission matrix", matrixMatches("ADMIN", ["seller.read", "catalog.read", "catalog.manage", "orders.read", "orders.manage", "conversation_config.read", "conversation_config.manage", "whatsapp_connection.read", "whatsapp_connection.manage", "memberships.read", "analytics.read"]));
    add("AGENT permission matrix", matrixMatches("AGENT", ["seller.read", "catalog.read", "orders.read", "orders.manage", "conversation_config.read", "analytics.read", "whatsapp_connection.read"]));
    add("VIEWER permission matrix", matrixMatches("VIEWER", ["seller.read", "catalog.read", "orders.read", "conversation_config.read", "analytics.read", "whatsapp_connection.read"]));
    add("Deny-by-default behavior", !roleHasPermission("ADMIN", "seller.manage") && !roleHasPermission("ADMIN", "memberships.manage"));

    const owner = await createUser(repository, prefix, "owner");
    const second = await createUser(repository, prefix, "second");
    const noMembership = await createUser(repository, prefix, "nomembership");
    const sellerA = `seller_${prefix}_a`;
    const sellerB = `seller_${prefix}_b`;
    const sellerC = `seller_${prefix}_c`;
    sellerIds.push(sellerA, sellerB, sellerC);
    await createSeller(sellerA);
    await createSeller(sellerB);
    await createSeller(sellerC);
    await repository.createSellerMembership({ sellerId: sellerA, userId: owner.userId, role: "OWNER", status: "active" });

    const ownerPrincipal = await sessionAuthService.resolve((await sessionAuthService.issueSessionForUser(owner)).session.rawToken);
    if (!ownerPrincipal) throw new Error("Owner principal fixture missing.");

    add("Unknown permission rejection", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, permission: "unknown.permission" as AuthPermission }), AuthorizationInsufficientPermissionError));
    add("One active membership auto-resolution", (await authorizationService.authorize({ principal: ownerPrincipal, permission: "seller.read" })).tenant.sellerId === sellerA);
    add("Explicit authorized seller selection", (await authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: sellerA, permission: "seller.manage" })).tenant.sellerId === sellerA);
    add("Requested seller without membership is generic forbidden", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: sellerB, permission: "seller.read" }), AuthorizationInsufficientPermissionError));
    add("No active memberships", await expectsError(async () => {
      const principal = await sessionAuthService.resolve((await sessionAuthService.issueSessionForUser(noMembership)).session.rawToken);
      if (!principal) throw new Error("No membership principal fixture missing.");
      await authorizationService.authorize({ principal, permission: "seller.read" });
    }, AuthorizationNoActiveMembershipError));

    await repository.createSellerMembership({ sellerId: sellerC, userId: owner.userId, role: "VIEWER", status: "active" });
    add("Multiple memberships require explicit seller selection", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, permission: "seller.read" }), AuthorizationTenantSelectionRequiredError));
    add("Cross-tenant read denial", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: sellerB, permission: "orders.read" }), AuthorizationInsufficientPermissionError));
    add("Cross-tenant write denial", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: sellerB, permission: "orders.manage" }), AuthorizationInsufficientPermissionError));

    const disabledUser = await createUser(repository, prefix, "disabledmembership");
    await repository.createSellerMembership({ sellerId: sellerB, userId: disabledUser.userId, role: "OWNER", status: "disabled" });
    const disabledPrincipal = await sessionAuthService.resolve((await sessionAuthService.issueSessionForUser(disabledUser)).session.rawToken);
    if (!disabledPrincipal) throw new Error("Disabled membership principal fixture missing.");
    add("Disabled membership grants no access", await expectsError(() => authorizationService.authorize({ principal: disabledPrincipal, requestedSellerId: sellerB, permission: "seller.read" }), AuthorizationNoActiveMembershipError));

    add("Invalid seller ID", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: 123, permission: "seller.read" }), AuthorizationInvalidSellerTargetError));
    add("Blank seller ID", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: "   ", permission: "seller.read" }), AuthorizationInvalidSellerTargetError));
    add("default-seller rejection", await expectsError(() => authorizationService.authorize({ principal: ownerPrincipal, requestedSellerId: "Default Seller", permission: "seller.read" }), AuthorizationInvalidSellerTargetError));

    const admin = await createUser(repository, prefix, "admin");
    const agent = await createUser(repository, prefix, "agent");
    const viewer = await createUser(repository, prefix, "viewer");
    await repository.createSellerMembership({ sellerId: sellerA, userId: admin.userId, role: "ADMIN", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: agent.userId, role: "AGENT", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: viewer.userId, role: "VIEWER", status: "active" });
    const adminPrincipal = await sessionAuthService.resolve((await sessionAuthService.issueSessionForUser(admin)).session.rawToken);
    const agentPrincipal = await sessionAuthService.resolve((await sessionAuthService.issueSessionForUser(agent)).session.rawToken);
    const viewerPrincipal = await sessionAuthService.resolve((await sessionAuthService.issueSessionForUser(viewer)).session.rawToken);
    if (!adminPrincipal || !agentPrincipal || !viewerPrincipal) throw new Error("Role principal fixture missing.");

    add("ADMIN denied memberships.manage", await expectsError(() => authorizationService.authorize({ principal: adminPrincipal, requestedSellerId: sellerA, permission: "memberships.manage" }), AuthorizationInsufficientPermissionError));
    add("AGENT denied catalog.manage", await expectsError(() => authorizationService.authorize({ principal: agentPrincipal, requestedSellerId: sellerA, permission: "catalog.manage" }), AuthorizationInsufficientPermissionError));
    add("AGENT allowed orders.manage", (await authorizationService.authorize({ principal: agentPrincipal, requestedSellerId: sellerA, permission: "orders.manage" })).tenant.sellerId === sellerA);
    add("VIEWER denied all write permissions", await Promise.all(["seller.manage", "catalog.manage", "orders.manage", "conversation_config.manage", "whatsapp_connection.manage", "memberships.manage"].map((permission) => expectsError(() => authorizationService.authorize({ principal: viewerPrincipal, requestedSellerId: sellerA, permission: permission as AuthPermission }), AuthorizationInsufficientPermissionError))).then((results) => results.every(Boolean)));

    const revokedUser = await createUser(repository, prefix, "revoked");
    await repository.createSellerMembership({ sellerId: sellerB, userId: revokedUser.userId, role: "OWNER", status: "active" });
    const revokedCookie = await issueCookie(sessionAuthService, revokedUser);
    await repository.setSellerMembershipStatus(sellerB, revokedUser.userId, "disabled", new Date());
    add("Membership revoked after session creation takes effect", (await request(baseUrl, `/protected?sellerId=${encodeURIComponent(sellerB)}`, { cookie: revokedCookie })).status === 403);

    const agentCookie = await issueCookie(sessionAuthService, agent);
    const authorizedMiddleware = await request(baseUrl, `/protected?sellerId=${encodeURIComponent(sellerA)}&role=OWNER&permission=memberships.manage`, { method: "POST", cookie: agentCookie, body: { role: "OWNER", permission: "memberships.manage" } });
    add("Authenticated principal required", (await request(baseUrl, `/protected?sellerId=${encodeURIComponent(sellerA)}`)).status === 401);
    add("401 versus 403 mapping", (await request(baseUrl, `/protected?sellerId=${encodeURIComponent(sellerA)}`)).status === 401 && (await request(baseUrl, `/protected?sellerId=${encodeURIComponent(sellerB)}`, { cookie: agentCookie })).status === 403);
    add("Trusted TenantContext attached only after success", authorizedMiddleware.status === 200 && (authorizedMiddleware.body as { tenantAttached?: unknown; sellerId?: unknown }).tenantAttached === true && (authorizedMiddleware.body as { sellerId?: unknown }).sellerId === sellerA);
    add("No client-supplied role escalation", (authorizedMiddleware.body as { role?: unknown }).role === "AGENT");
    add("No client-supplied permission escalation", (authorizedMiddleware.body as { permission?: unknown }).permission === "orders.manage");
    const missingSeller = await request(baseUrl, `/protected?sellerId=${encodeURIComponent(`seller_${prefix}_missing`)}`, { cookie: agentCookie });
    add("No seller existence disclosure", missingSeller.status === 403 && missingSeller.text === JSON.stringify({ message: "Forbidden." }));

    const { server: fullServer, baseUrl: fullBaseUrl } = await startServer(app);
    try {
      add("Middleware not applied to WhatsApp webhook", (await request(fullBaseUrl, "/api/whatsapp/cloud/webhook")).status !== 401);
    } finally {
      await stopServer(fullServer);
    }
  } finally {
    await stopServer(server);
    await cleanup(prefix, sellerIds);
    add("Phase 9F rows are cleaned up", (await userIdsByPrefix(prefix)).length === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9F authorization test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
