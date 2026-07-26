import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { env } from "../../../config/env";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import { hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { csrfOriginProtection } from "../http/csrf-origin.middleware";
import { trustedFrontendCorsOptions } from "../http/cors-options";
import { AUTH_COOKIE_NAME } from "../http/auth-cookie";
import { createAuthRoutes } from "../auth.routes";
import { requireAuthenticatedPrincipal, requirePermission } from "../http/auth.middleware";
import { resolveRequestedSellerTarget } from "../http/seller-target.resolver";
import {
  AuthRateLimiter,
  AuthorizationService,
  GoogleAuthService,
  InMemoryAuthRateLimitStore,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  SessionAuthService,
  type AuthPermission,
  type AuthRateLimitStore,
  type AuthUser,
  type GoogleIdentityProvider,
  type VerifiedGoogleIdentity,
} from "../index";

dotenv.config();
process.env.FRONTEND_BASE_URL ||= "https://frontend.phase9h.example";
env.frontendBaseUrl = process.env.FRONTEND_BASE_URL.replace(/\/+$/u, "");

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body?: unknown; text: string; headers: Headers; setCookie?: string }>;

const cases: TestCase[] = [];
const trustedOrigin = new URL(process.env.FRONTEND_BASE_URL).origin;
const untrustedOrigin = "https://evil.phase9h.example";

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

class FailingRateLimitStore implements AuthRateLimitStore {
  async increment(): Promise<Readonly<{ count: number; retryAfterSeconds: number }>> {
    throw new Error("limiter unavailable");
  }

  async clear(): Promise<void> {
    throw new Error("limiter unavailable");
  }
}

class FakeGoogleIdentityProvider implements GoogleIdentityProvider {
  readonly identities = new Map<string, VerifiedGoogleIdentity>();

  buildAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  async exchangeCodeForIdentity(input: { code: string }): Promise<VerifiedGoogleIdentity> {
    const identity = this.identities.get(input.code);
    if (!identity) throw new Error("invalid identity");
    return identity;
  }
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

async function request(baseUrl: string, path: string, input: Readonly<{ method?: string; body?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> }> = {}): Promise<HttpResponse> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: input.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
        ...(input.cookie ? { cookie: input.cookie } : {}),
        ...(input.origin ? { origin: input.origin } : {}),
        ...input.headers,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
  } catch (error) {
    throw new Error(`Request timed out or failed: ${input.method ?? "GET"} ${path}`, { cause: error });
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text, headers: response.headers, setCookie: response.headers.get("set-cookie") ?? undefined };
}

function cookieHeader(setCookie: string | undefined): string {
  return setCookie?.split(";")[0] ?? "";
}

function cookieValue(setCookie: string | undefined): string | undefined {
  return cookieHeader(setCookie).split("=").slice(1).join("=") || undefined;
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
  return repository.createUser({ userId: randomUUID(), emailNormalized: `${prefix}_${label}@example.com`, status: "active" });
}

async function issueCookie(sessionAuthService: SessionAuthService, user: AuthUser): Promise<string> {
  const result = await sessionAuthService.issueSessionForUser(user);
  return `${AUTH_COOKIE_NAME}=${result.session.rawToken}`;
}

function createProbeApp(repository: PostgreSqlAuthRepository, limiter = new AuthRateLimiter(new InMemoryAuthRateLimitStore())): express.Express {
  const passwordAuthService = new PasswordAuthService(repository);
  const sessionAuthService = new SessionAuthService(repository, passwordAuthService);
  const authorizationService = new AuthorizationService(repository);
  const app = express();
  app.use(cors(trustedFrontendCorsOptions));
  app.use(express.json());
  app.use(csrfOriginProtection);
  const provider = new FakeGoogleIdentityProvider();
  const composition = {
    authRepositories: repository,
    passwordAuthService,
    accountRecoveryService: createAuthComposition().accountRecoveryService,
    sessionAuthService,
    googleAuthService: new GoogleAuthService(repository, sessionAuthService, provider, {
      enabled: true,
      clientId: "phase9h",
      clientSecret: "phase9h",
      callbackUrl: "http://127.0.0.1/api/auth/google/callback",
      frontendBaseUrl: trustedOrigin,
      postLoginPath: "/reseller/dashboard",
    }),
    authorizationService,
    authRateLimiter: limiter,
  };
  app.use("/api/auth", createAuthRoutes(composition));
  const addProbe = (path: string, permission: AuthPermission) => app.all(
    path,
    requireAuthenticatedPrincipal(sessionAuthService),
    requirePermission(authorizationService, permission, resolveRequestedSellerTarget),
    (req, res) => {
      const authorized = req as typeof req & { tenant?: { sellerId: string }; authorization?: { permission: AuthPermission } };
      res.status(200).json({ sellerId: authorized.tenant?.sellerId, permission: authorized.authorization?.permission, tenantAttached: Boolean(authorized.tenant) });
    },
  );
  addProbe("/orders", "orders.read");
  addProbe("/orders-write", "orders.manage");
  addProbe("/catalog-write", "catalog.manage");
  return app;
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("No I/O on import", !getDatabasePoolState().initialized);

  const realAppModule = await import("../../../app.js");
  const realApp = (realAppModule.default as unknown as { default: RequestListener }).default;
  const { server: realServer, baseUrl } = await startServer(realApp);
  const prefix = `phase9h_${randomUUID().replace(/-/gu, "")}`;
  const repository = new PostgreSqlAuthRepository();
  const limiterStore = new InMemoryAuthRateLimitStore();
  const probeApp = createProbeApp(repository, new AuthRateLimiter(limiterStore));
  const { server: probeServer, baseUrl: probeBaseUrl } = await startServer(probeApp);
  const sellerIds: string[] = [];

  try {
    await cleanup(prefix, sellerIds);
    const password = "Str0ng!Phase9H";
    const sellerA = `seller_${prefix}_a`;
    const sellerB = `seller_${prefix}_b`;
    sellerIds.push(sellerA, sellerB);
    await createSeller(sellerA);
    await createSeller(sellerB);
    await new PasswordAuthService(repository).signup({ email: `${prefix}_login@example.com`, password });
    await new PasswordAuthService(repository).signup({ email: `${prefix}_recover@example.com`, password });
    await new PasswordAuthService(repository).signup({ email: `${prefix}_session@example.com`, password });

    const trustedCors = await request(baseUrl, "/health", { origin: trustedOrigin });
    const untrustedCors = await request(baseUrl, "/health", { origin: untrustedOrigin });
    const preflight = await request(baseUrl, "/api/auth/login", { method: "OPTIONS", origin: trustedOrigin, headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    add("Trusted frontend origin allowed with credentials", trustedCors.headers.get("access-control-allow-origin") === trustedOrigin && trustedCors.headers.get("access-control-allow-credentials") === "true");
    add("Untrusted origin not allowed", untrustedCors.headers.get("access-control-allow-origin") === null);
    add("Wildcard is never used with credentials", trustedCors.headers.get("access-control-allow-origin") !== "*" && preflight.headers.get("access-control-allow-origin") !== "*");
    add("Preflight behavior", preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === trustedOrigin);
    add("WhatsApp webhook unaffected by CORS assumptions", (await request(baseUrl, "/api/whatsapp/cloud/webhook", { origin: untrustedOrigin })).status !== 401);

    const signup = await request(probeBaseUrl, "/api/auth/signup", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_http@example.com`, password } });
    const authCookie = cookieHeader(signup.setCookie);
    add("Trusted-origin authenticated mutation reaches authorization layer", (await request(probeBaseUrl, `/orders-write?sellerId=${sellerA}`, { method: "POST", origin: trustedOrigin, cookie: authCookie, body: {} })).status === 403);
    add("Untrusted-origin authenticated mutation rejected", (await request(probeBaseUrl, "/api/auth/logout", { method: "POST", origin: untrustedOrigin, cookie: authCookie })).status === 403);
    add("Safe GET unaffected", (await request(probeBaseUrl, "/api/auth/me", { origin: untrustedOrigin, cookie: authCookie })).status === 200);
    add("Logout protected correctly", (await request(probeBaseUrl, "/api/auth/logout", { method: "POST", origin: trustedOrigin, cookie: authCookie })).status === 204);
    add("Public Google callback unaffected", (await request(probeBaseUrl, "/api/auth/google/callback?code=missing&state=missing", { origin: untrustedOrigin })).status === 400);
    add("Webhook and health routes excluded from CSRF", (await request(baseUrl, "/health", { origin: untrustedOrigin })).status === 200 && (await request(baseUrl, "/api/whatsapp/cloud/webhook", { method: "POST", origin: untrustedOrigin, body: {} })).status !== 403);

    for (let index = 0; index < 5; index += 1) {
      await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_login@example.com`, password: "wrong" } });
    }
    const limitedLogin = await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_login@example.com`, password: "wrong" } });
    add("Repeated wrong-password login reaches 429", limitedLogin.status === 429);
    add("Retry-After present", limitedLogin.headers.get("retry-after") !== null);
    add("Unknown-email attempts use equivalent public behavior", (await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_unknown@example.com`, password: "wrong" } })).status === 401);
    await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_recover@example.com`, password: "wrong" } });
    add("Successful login recovery behavior", (await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_recover@example.com`, password } })).status === 200);
    for (let index = 0; index < 5; index += 1) {
      await request(probeBaseUrl, "/api/auth/signup", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_abuse@example.com`, password: "short" } });
    }
    add("Signup abuse protection", (await request(probeBaseUrl, "/api/auth/signup", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_abuse@example.com`, password: "short" } })).status === 429);
    for (let index = 0; index < 5; index += 1) {
      await request(probeBaseUrl, "/api/auth/password/forgot", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_login@example.com` } });
    }
    add("Recovery request abuse protection", (await request(probeBaseUrl, "/api/auth/password/forgot", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_login@example.com` } })).status === 429);
    add("No plaintext sensitive values in rate keys", limiterStore.keys.every((key) => !key.includes(password) && !key.includes(`${prefix}_login@example.com`)));
    const failingApp = createProbeApp(repository, new AuthRateLimiter(new FailingRateLimitStore()));
    const { server: failingServer, baseUrl: failingBaseUrl } = await startServer(failingApp);
    try {
      add("Limiter adapter failure behavior", (await request(failingBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_login@example.com`, password } })).status === 503);
    } finally {
      await stopServer(failingServer);
    }
    add("WhatsApp webhook not rate limited by auth limiter", (await request(baseUrl, "/api/whatsapp/cloud/webhook", { method: "POST", body: {} })).status !== 429);

    const sessionAuthService = new SessionAuthService(repository, new PasswordAuthService(repository));
    const owner = await createUser(repository, prefix, "owner");
    const admin = await createUser(repository, prefix, "admin");
    const agent = await createUser(repository, prefix, "agent");
    const viewer = await createUser(repository, prefix, "viewer");
    const revoked = await createUser(repository, prefix, "revoked");
    await repository.createSellerMembership({ sellerId: sellerA, userId: owner.userId, role: "OWNER", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: admin.userId, role: "ADMIN", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: agent.userId, role: "AGENT", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerA, userId: viewer.userId, role: "VIEWER", status: "active" });
    await repository.createSellerMembership({ sellerId: sellerB, userId: revoked.userId, role: "OWNER", status: "active" });
    const ownerCookie = await issueCookie(sessionAuthService, owner);
    const adminCookie = await issueCookie(sessionAuthService, admin);
    const agentCookie = await issueCookie(sessionAuthService, agent);
    const viewerCookie = await issueCookie(sessionAuthService, viewer);
    const revokedCookie = await issueCookie(sessionAuthService, revoked);
    add("OWNER allowed", (await request(probeBaseUrl, `/orders?sellerId=${sellerA}`, { cookie: ownerCookie })).status === 200);
    add("ADMIN restrictions preserved", (await request(probeBaseUrl, `/catalog-write?sellerId=${sellerA}`, { method: "POST", origin: trustedOrigin, cookie: adminCookie, body: {} })).status === 200);
    add("AGENT restrictions preserved", (await request(probeBaseUrl, `/catalog-write?sellerId=${sellerA}`, { method: "POST", origin: trustedOrigin, cookie: agentCookie, body: {} })).status === 403 && (await request(probeBaseUrl, `/orders-write?sellerId=${sellerA}`, { method: "POST", origin: trustedOrigin, cookie: agentCookie, body: {} })).status === 200);
    add("VIEWER write denied", (await request(probeBaseUrl, `/orders-write?sellerId=${sellerA}`, { method: "POST", origin: trustedOrigin, cookie: viewerCookie, body: {} })).status === 403);
    add("Cross-tenant read denied", (await request(probeBaseUrl, `/orders?sellerId=${sellerB}`, { cookie: ownerCookie })).status === 403);
    add("Cross-tenant write denied", (await request(probeBaseUrl, `/orders-write?sellerId=${sellerB}`, { method: "POST", origin: trustedOrigin, cookie: ownerCookie, body: {} })).status === 403);
    await repository.setSellerMembershipStatus(sellerB, revoked.userId, "disabled", new Date());
    add("Revoked membership takes effect during an existing session", (await request(probeBaseUrl, `/orders?sellerId=${sellerB}`, { cookie: revokedCookie })).status === 403);
    add("Client role/permission escalation ignored", (await request(probeBaseUrl, `/catalog-write?sellerId=${sellerA}&permission=catalog.manage`, { method: "POST", origin: trustedOrigin, cookie: agentCookie, body: { role: "OWNER", permission: "catalog.manage" } })).status === 403);
    const tenantSuccess = await request(probeBaseUrl, `/orders?sellerId=${sellerA}`, { cookie: ownerCookie });
    add("Trusted TenantContext reaches controllers only after authorization", tenantSuccess.status === 200 && (tenantSuccess.body as { tenantAttached?: unknown; sellerId?: unknown }).tenantAttached === true && (tenantSuccess.body as { sellerId?: unknown }).sellerId === sellerA);

    const meLogin = await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_session@example.com`, password } });
    const meCookie = cookieHeader(meLogin.setCookie);
    add("Valid login/session/me/logout", meLogin.status === 200 && (await request(probeBaseUrl, "/api/auth/me", { cookie: meCookie })).status === 200 && (await request(probeBaseUrl, "/api/auth/logout", { method: "POST", origin: trustedOrigin, cookie: meCookie })).status === 204);
    const rawExpiredToken = cookieValue((await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_session@example.com`, password } })).setCookie);
    await executeDatabaseQuery({ text: "UPDATE auth_sessions SET created_at = NOW() - INTERVAL '2 seconds', expires_at = NOW() - INTERVAL '1 second' WHERE session_token_hash = $1", values: [hashOpaqueToken(rawExpiredToken)] });
    add("Expired and revoked sessions", (await request(probeBaseUrl, "/api/auth/me", { cookie: `${AUTH_COOKIE_NAME}=${rawExpiredToken}` })).status === 401);
    const resetA = await request(probeBaseUrl, "/api/auth/login", { method: "POST", origin: trustedOrigin, body: { email: `${prefix}_session@example.com`, password } });
    await sessionAuthService.revokeAllSessionsForUser((await repository.findUserByEmail(`${prefix}_session@example.com`))!.userId);
    add("Password reset revokes sessions", (await request(probeBaseUrl, "/api/auth/me", { cookie: cookieHeader(resetA.setCookie) })).status === 401);
    add("Google verified identity flow", (await request(probeBaseUrl, "/api/auth/google/start")).status === 302);
    add("Invalid state/nonce/PKCE", (await request(probeBaseUrl, "/api/auth/google/callback?code=missing&state=missing")).status === 400);
    add("No token or hash returned", !String(meLogin.text).includes(AUTH_COOKIE_NAME) && !String(meLogin.text).includes("sessionTokenHash") && !String(meLogin.text).includes("passwordHash"));
    add("No global user-auth middleware", (await request(baseUrl, "/privacy")).status === 200);
    add("No unrelated route behavior changed", (await request(baseUrl, "/health")).status === 200);
  } finally {
    await stopServer(probeServer);
    await stopServer(realServer);
    await cleanup(prefix, sellerIds);
    add("Phase 9H rows are cleaned up", (await userIdsByPrefix(prefix)).length === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9H auth security closure test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
