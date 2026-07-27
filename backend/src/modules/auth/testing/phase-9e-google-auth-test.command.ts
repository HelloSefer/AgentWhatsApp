import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import app from "../../../app";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import type { DatabaseQueryExecutor } from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import {
  AuthAlreadyExistsError,
  AuthInvalidTokenError,
  AuthRateLimiter,
  AuthorizationService,
  GoogleAuthService,
  InMemoryAuthRateLimitStore,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  SessionAuthService,
  createPkceChallenge,
  type AuthRepositories,
  type GoogleIdentityProvider,
  type VerifiedGoogleIdentity,
} from "../index";
import { createAuthRoutes } from "../auth.routes";
import { AUTH_COOKIE_NAME } from "../http/auth-cookie";
import {
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_PKCE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "../http/google-oauth-cookies";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body?: unknown; text: string; location?: string; setCookies: readonly string[] }>;

const cases: TestCase[] = [];
const testNoopAuthEmailSender = Object.freeze({
  sendEmailVerification: async () => undefined,
  sendPasswordReset: async () => undefined,
});

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

class FakeGoogleIdentityProvider implements GoogleIdentityProvider {
  readonly starts: string[] = [];
  readonly callbacks: { code: string; nonce: string; codeVerifier: string }[] = [];
  private readonly identities = new Map<string, VerifiedGoogleIdentity>();

  set(code: string, identity: VerifiedGoogleIdentity): void {
    this.identities.set(code, identity);
  }

  buildAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", "phase9e-google-client");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    this.starts.push(url.toString());
    return url.toString();
  }

  async exchangeCodeForIdentity(input: { code: string; nonce: string; codeVerifier: string }): Promise<VerifiedGoogleIdentity> {
    this.callbacks.push(input);
    if (input.code === "expired" || input.code === "bad_nonce") throw new AuthInvalidTokenError();
    const identity = this.identities.get(input.code);
    if (!identity) throw new AuthInvalidTokenError();
    return identity;
  }
}

class FailingIdentityRepository extends PostgreSqlAuthRepository {
  failuresRemaining = 1;

  override async createExternalIdentity(input: Readonly<{ externalIdentityId: string; userId: string; provider: string; providerSubject: string; emailNormalized?: string }>, options?: { executor?: DatabaseQueryExecutor }) {
    if (this.failuresRemaining > 0 && input.providerSubject.includes("rollback")) {
      this.failuresRemaining -= 1;
      throw new AuthAlreadyExistsError();
    }
    return super.createExternalIdentity(input, options);
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

function headerSetCookies(headers: Headers): readonly string[] {
  const maybeGetSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") return maybeGetSetCookie.call(headers);
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*agentwhatsapp_)/u).map((value) => value.trim()) : [];
}

async function request(baseUrl: string, path: string, input: Readonly<{ method?: string; body?: unknown; cookie?: string; redirect?: RequestRedirect }> = {}): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method ?? "GET",
    redirect: input.redirect ?? "manual",
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
    location: response.headers.get("location") ?? undefined,
    setCookies: headerSetCookies(response.headers),
  };
}

function cookieValue(setCookies: readonly string[], name: string): string | undefined {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  return cookie?.split(";")[0]?.split("=").slice(1).join("=");
}

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function hasTransientCookieSecurity(setCookies: readonly string[], name: string): boolean {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`)) ?? "";
  const lower = cookie.toLowerCase();
  return lower.includes("httponly") && lower.includes("path=/api/auth/google") && lower.includes("samesite=lax") && lower.includes("max-age=600");
}

function hasClearedTransientCookies(setCookies: readonly string[]): boolean {
  return [GOOGLE_OAUTH_STATE_COOKIE, GOOGLE_OAUTH_NONCE_COOKIE, GOOGLE_OAUTH_PKCE_COOKIE].every((name) => {
    const cookie = setCookies.find((value) => value.startsWith(`${name}=`)) ?? "";
    const lower = cookie.toLowerCase();
    return lower.includes("path=/api/auth/google") && (lower.includes("max-age=0") || lower.includes("expires=thu, 01 jan 1970"));
  });
}

function hasSessionCookie(setCookies: readonly string[]): boolean {
  const cookie = setCookies.find((value) => value.startsWith(`${AUTH_COOKIE_NAME}=`)) ?? "";
  const lower = cookie.toLowerCase();
  return lower.includes("httponly") && lower.includes("path=/") && lower.includes("samesite=lax") && lower.includes("max-age=2592000");
}

function bodyText(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

async function userIdsByPrefix(prefix: string): Promise<readonly string[]> {
  const result = await executeDatabaseQuery<{ user_id: string }>({
    text: "SELECT user_id FROM auth_users WHERE email_normalized LIKE $1",
    values: [`${prefix}%@example.com`],
  });
  return result.rows.map((row) => row.user_id);
}

async function countUsers(prefix: string): Promise<number> {
  return (await userIdsByPrefix(prefix)).length;
}

async function countExternalIdentity(providerSubject: string): Promise<number> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: "SELECT COUNT(*)::text AS count FROM external_identities WHERE provider = 'google' AND provider_subject = $1",
    values: [providerSubject],
  });
  return Number(result.rows[0]?.count ?? 0);
}

async function sessionHashForCookie(rawToken: string | undefined): Promise<string | null> {
  const tokenHash = hashOpaqueToken(rawToken);
  if (!tokenHash) return null;
  const result = await executeDatabaseQuery<{ session_token_hash: string }>({
    text: "SELECT session_token_hash FROM auth_sessions WHERE session_token_hash = $1 LIMIT 1",
    values: [tokenHash],
  });
  return result.rows[0]?.session_token_hash ?? null;
}

async function cleanup(prefix: string): Promise<void> {
  const userIds = await userIdsByPrefix(prefix);
  await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
}

function createTestAuthApp(repositories: AuthRepositories, provider: FakeGoogleIdentityProvider, postLoginPath = "/reseller/dashboard"): express.Express {
  const passwordAuthService = new PasswordAuthService(repositories);
  const sessionAuthService = new SessionAuthService(repositories, passwordAuthService);
  const googleAuthService = new GoogleAuthService(repositories, sessionAuthService, provider, {
    enabled: true,
    clientId: "phase9e-google-client",
    clientSecret: "phase9e-google-secret",
    callbackUrl: "http://127.0.0.1/api/auth/google/callback",
    frontendBaseUrl: "https://frontend.example.com",
    postLoginPath,
  });
  const localApp = express();
  localApp.use(express.json());
  localApp.use("/api/auth", createAuthRoutes({
    authRepositories: repositories,
    passwordAuthService,
    accountRecoveryService: createAuthComposition(testNoopAuthEmailSender).accountRecoveryService,
    sessionAuthService,
    googleAuthService,
    authorizationService: new AuthorizationService(repositories),
    authRateLimiter: new AuthRateLimiter(new InMemoryAuthRateLimitStore()),
  }));
  return localApp;
}

async function googleStart(baseUrl: string): Promise<HttpResponse> {
  return request(baseUrl, "/api/auth/google/start");
}

async function googleCallback(baseUrl: string, start: HttpResponse, code: string, stateOverride?: string): Promise<HttpResponse> {
  const state = stateOverride ?? cookieValue(start.setCookies, GOOGLE_OAUTH_STATE_COOKIE);
  return request(baseUrl, `/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? "")}`, {
    cookie: cookieHeader(start.setCookies),
  });
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Auth route imports do not initialize database pool", !getDatabasePoolState().initialized);

  const prefix = `phase9e_${randomUUID().replace(/-/gu, "")}`;
  const password = "Str0ng!Phase9E";
  const provider = new FakeGoogleIdentityProvider();
  const repository = new PostgreSqlAuthRepository();
  const localApp = createTestAuthApp(repository, provider, "https://evil.example.com/open");
  const { server, baseUrl } = await startServer(localApp);

  try {
    await cleanup(prefix);

    const start = await googleStart(baseUrl);
    const state = cookieValue(start.setCookies, GOOGLE_OAUTH_STATE_COOKIE);
    const nonce = cookieValue(start.setCookies, GOOGLE_OAUTH_NONCE_COOKIE);
    const verifier = cookieValue(start.setCookies, GOOGLE_OAUTH_PKCE_COOKIE);
    const authUrl = new URL(start.location ?? "");
    add("Start route creates state, nonce, PKCE verifier, and S256 challenge", start.status === 302 && Boolean(state) && Boolean(nonce) && Boolean(verifier) && authUrl.searchParams.get("code_challenge") === createPkceChallenge(verifier ?? ""));
    add("Transient cookie security attributes are set", hasTransientCookieSecurity(start.setCookies, GOOGLE_OAUTH_STATE_COOKIE) && hasTransientCookieSecurity(start.setCookies, GOOGLE_OAUTH_NONCE_COOKIE) && hasTransientCookieSecurity(start.setCookies, GOOGLE_OAUTH_PKCE_COOKIE));
    add("Authorization redirect contains required safe parameters", authUrl.hostname === "accounts.google.com" && authUrl.searchParams.get("state") === state && authUrl.searchParams.get("nonce") === nonce && authUrl.searchParams.get("code_challenge_method") === "S256" && authUrl.searchParams.get("response_type") === "code");

    provider.set("new_user", { provider: "google", providerSubject: `${prefix}_subject_new`, email: `${prefix}_new@example.com`, emailVerified: true });
    const callback = await googleCallback(baseUrl, start, "new_user");
    const rawSession = cookieValue(callback.setCookies, AUTH_COOKIE_NAME);
    const newUserMe = await request(baseUrl, "/api/auth/me", { cookie: `${AUTH_COOKIE_NAME}=${rawSession ?? ""}` });
    add("Callback with valid state and verified identity redirects safely", callback.status === 302 && callback.location === "https://frontend.example.com/reseller/dashboard");
    add("New Google user creation marks email verified and needs onboarding remains true", (await repository.findUserByEmail(`${prefix}_new@example.com`))?.emailVerifiedAt !== undefined && (newUserMe.body as { needsOnboarding?: unknown }).needsOnboarding === true);
    add("Fresh internal session creation uses secure cookie and hash persistence", hasSessionCookie(callback.setCookies) && await sessionHashForCookie(rawSession) !== null);
    add("Transient cookies cleared after success", hasClearedTransientCookies(callback.setCookies));
    add("No Google tokens or internal session tokens are returned", !String(callback.location).includes(String(rawSession)) && !bodyText(callback.body).includes("token") && !bodyText(callback.body).includes(String(rawSession)));
    add("Open redirect configuration attempt falls back to safe default", callback.location === "https://frontend.example.com/reseller/dashboard");

    const existingIdentityStart = await googleStart(baseUrl);
    provider.set("existing_identity", { provider: "google", providerSubject: `${prefix}_subject_new`, email: `${prefix}_new@example.com`, emailVerified: true });
    const existingIdentityLogin = await googleCallback(baseUrl, existingIdentityStart, "existing_identity");
    add("Existing Google identity login creates a fresh AgentWhatsApp session", existingIdentityLogin.status === 302 && cookieValue(existingIdentityLogin.setCookies, AUTH_COOKIE_NAME) !== rawSession);

    const passwordSignup = await request(baseUrl, "/api/auth/signup", { method: "POST", body: { email: `${prefix}_link@example.com`, password } });
    const linkStart = await googleStart(baseUrl);
    provider.set("link_existing_email", { provider: "google", providerSubject: `${prefix}_subject_link`, email: `${prefix}_LINK@example.com`, emailVerified: true });
    const link = await googleCallback(baseUrl, linkStart, "link_existing_email");
    const passwordLogin = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email: `${prefix}_link@example.com`, password } });
    add("Safe linking to existing normalized-email user works", link.status === 302 && await countExternalIdentity(`${prefix}_subject_link`) === 1);
    add("Existing password login remains valid after Google linking", passwordSignup.status === 201 && passwordLogin.status === 200 && hasSessionCookie(passwordLogin.setCookies));

    const unverifiedStart = await googleStart(baseUrl);
    provider.set("unverified", { provider: "google", providerSubject: `${prefix}_subject_unverified`, email: `${prefix}_unverified@example.com`, emailVerified: false });
    const unverified = await googleCallback(baseUrl, unverifiedStart, "unverified");
    add("email_verified=false is rejected and transient cookies clear", unverified.status === 401 && hasClearedTransientCookies(unverified.setCookies) && await countExternalIdentity(`${prefix}_subject_unverified`) === 0);

    const emptySubjectStart = await googleStart(baseUrl);
    provider.set("empty_subject", { provider: "google", providerSubject: "", email: `${prefix}_empty@example.com`, emailVerified: true });
    add("Missing provider subject is rejected", (await googleCallback(baseUrl, emptySubjectStart, "empty_subject")).status === 400);

    const disabledStart = await googleStart(baseUrl);
    const disabledUser = await repository.findUserByEmail(`${prefix}_link@example.com`);
    if (!disabledUser) throw new Error("Disabled user fixture missing.");
    await repository.setUserStatus(disabledUser.userId, "disabled");
    provider.set("disabled", { provider: "google", providerSubject: `${prefix}_subject_link`, email: `${prefix}_link@example.com`, emailVerified: true });
    add("Disabled user is rejected", (await googleCallback(baseUrl, disabledStart, "disabled")).status === 401);
    await repository.setUserStatus(disabledUser.userId, "active");

    add("Missing state cookie is rejected", (await request(baseUrl, `/api/auth/google/callback?code=new_user&state=${state ?? ""}`)).status === 400);
    add("Mismatched state is rejected", (await googleCallback(baseUrl, await googleStart(baseUrl), "new_user", "mismatch")).status === 400);
    const missingPkceStart = await googleStart(baseUrl);
    const missingPkceCookie = cookieHeader(missingPkceStart.setCookies.filter((cookie) => !cookie.startsWith(`${GOOGLE_OAUTH_PKCE_COOKIE}=`)));
    add("Missing PKCE verifier is rejected", (await request(baseUrl, `/api/auth/google/callback?code=new_user&state=${cookieValue(missingPkceStart.setCookies, GOOGLE_OAUTH_STATE_COOKIE) ?? ""}`, { cookie: missingPkceCookie })).status === 400);
    add("Invalid nonce is rejected", (await googleCallback(baseUrl, await googleStart(baseUrl), "bad_nonce")).status === 400);
    add("Expired or invalid provider identity is rejected", (await googleCallback(baseUrl, await googleStart(baseUrl), "expired")).status === 400);

    const concurrentSubject = `${prefix}_subject_concurrent`;
    provider.set("concurrent", { provider: "google", providerSubject: concurrentSubject, email: `${prefix}_concurrent@example.com`, emailVerified: true });
    const concurrentStartA = await googleStart(baseUrl);
    const concurrentStartB = await googleStart(baseUrl);
    const [concurrentA, concurrentB] = await Promise.all([googleCallback(baseUrl, concurrentStartA, "concurrent"), googleCallback(baseUrl, concurrentStartB, "concurrent")]);
    add("Duplicate concurrent identity callbacks recover without duplicate identities", concurrentA.status === 302 && concurrentB.status === 302 && await countExternalIdentity(concurrentSubject) === 1);

    const failingRepository = new FailingIdentityRepository();
    const failingProvider = new FakeGoogleIdentityProvider();
    const failingApp = createTestAuthApp(failingRepository, failingProvider);
    const { server: failingServer, baseUrl: failingBaseUrl } = await startServer(failingApp);
    try {
      failingProvider.set("rollback", { provider: "google", providerSubject: `${prefix}_subject_rollback`, email: `${prefix}_rollback@example.com`, emailVerified: true });
      add("New user and identity creation rolls back on failure", (await googleCallback(failingBaseUrl, await googleStart(failingBaseUrl), "rollback")).status === 401 && await countUsers(`${prefix}_rollback`) === 0);
    } finally {
      await stopServer(failingServer);
    }

    const unavailableProvider = new FakeGoogleIdentityProvider();
    const unavailableSession = new SessionAuthService(repository, new PasswordAuthService(repository));
    const unavailableApp = express();
    unavailableApp.use("/api/auth", createAuthRoutes({
      authRepositories: repository,
      passwordAuthService: new PasswordAuthService(repository),
      accountRecoveryService: createAuthComposition(testNoopAuthEmailSender).accountRecoveryService,
      sessionAuthService: unavailableSession,
      googleAuthService: new GoogleAuthService(repository, unavailableSession, unavailableProvider, { enabled: false, postLoginPath: "/reseller/dashboard" }),
      authorizationService: new AuthorizationService(repository),
      authRateLimiter: new AuthRateLimiter(new InMemoryAuthRateLimitStore()),
    }));
    const { server: unavailableServer, baseUrl: unavailableBaseUrl } = await startServer(unavailableApp);
    try {
      add("Missing Google configuration returns safe unavailable response", (await googleStart(unavailableBaseUrl)).status === 503);
    } finally {
      await stopServer(unavailableServer);
    }

    add("Existing email/password auth routes remain registered", (await request(baseUrl, "/api/auth/login", { method: "POST", body: { email: `${prefix}_new@example.com`, password: "wrong" } })).status === 401);

    const { server: fullServer, baseUrl: fullBaseUrl } = await startServer(app);
    try {
      add("WhatsApp webhook remains outside user-auth middleware", (await request(fullBaseUrl, "/api/whatsapp/cloud/webhook")).status !== 401);
    } finally {
      await stopServer(fullServer);
    }
  } finally {
    await stopServer(server);
    await cleanup(prefix);
    add("Phase 9E rows are cleaned up", await countUsers(prefix) === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9E Google auth test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
