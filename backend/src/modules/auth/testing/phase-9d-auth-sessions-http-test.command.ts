import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import { AUTH_COOKIE_NAME } from "../http/auth-cookie";
import { createAuthRoutes } from "../auth.routes";
import {
  PasswordAuthService,
  PostgreSqlAuthRepository,
  type AuthEmailSender,
  type AuthEmailVerificationMessage,
  type AuthPasswordResetMessage,
} from "../index";
import app from "../../../app";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type JsonResponse = Readonly<{ status: number; body: unknown; setCookie?: string; text: string }>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

class FakeAuthEmailSender implements AuthEmailSender {
  readonly verifications: AuthEmailVerificationMessage[] = [];
  readonly resets: AuthPasswordResetMessage[] = [];

  async sendEmailVerification(message: AuthEmailVerificationMessage): Promise<void> {
    this.verifications.push(message);
  }

  async sendPasswordReset(message: AuthPasswordResetMessage): Promise<void> {
    this.resets.push(message);
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
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function request(baseUrl: string, path: string, input: Readonly<{ method?: string; body?: unknown; cookie?: string }> = {}): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method ?? "GET",
    headers: {
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    setCookie: response.headers.get("set-cookie") ?? undefined,
    body: text ? JSON.parse(text) as unknown : undefined,
  };
}

function cookieHeader(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

function cookieValue(setCookie: string): string {
  return cookieHeader(setCookie).split("=").slice(1).join("=");
}

function hasCookieSecurity(setCookie: string): boolean {
  return setCookie.includes(`${AUTH_COOKIE_NAME}=`) &&
    setCookie.toLowerCase().includes("httponly") &&
    setCookie.toLowerCase().includes("path=/") &&
    setCookie.toLowerCase().includes("samesite=lax") &&
    setCookie.toLowerCase().includes("max-age=2592000");
}

function hasClearCookieSecurity(setCookie: string): boolean {
  return setCookie.includes(`${AUTH_COOKIE_NAME}=`) &&
    setCookie.toLowerCase().includes("path=/") &&
    setCookie.toLowerCase().includes("samesite=lax") &&
    (setCookie.toLowerCase().includes("expires=thu, 01 jan 1970") || setCookie.toLowerCase().includes("max-age=0"));
}

function bodyText(value: unknown): string {
  return JSON.stringify(value);
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
  await executeDatabaseQuery({
    text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])",
    values: [userIds],
  });
  await executeDatabaseQuery({
    text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
}

async function sessionHashForCookie(rawToken: string): Promise<string | null> {
  const tokenHash = hashOpaqueToken(rawToken);
  if (!tokenHash) return null;
  const result = await executeDatabaseQuery<{ session_token_hash: string }>({
    text: "SELECT session_token_hash FROM auth_sessions WHERE session_token_hash = $1 LIMIT 1",
    values: [tokenHash],
  });
  return result.rows[0]?.session_token_hash ?? null;
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Auth HTTP imports do not initialize database pool", !getDatabasePoolState().initialized);

  const prefix = `phase9d_${randomUUID().replace(/-/gu, "")}`;
  const sellerIds: string[] = [];
  const emailSender = new FakeAuthEmailSender();
  const composition = createAuthComposition(emailSender);
  const localApp = express();
  localApp.use(express.json());
  localApp.use("/api/auth", createAuthRoutes(composition));
  const { server, baseUrl } = await startServer(localApp);
  const repository = new PostgreSqlAuthRepository();
  const passwordAuth = new PasswordAuthService(repository);

  try {
    await cleanup(prefix, sellerIds);
    const password = "Str0ng!Phase9D";
    const email = `${prefix}@example.com`;

    const signup = await request(baseUrl, "/api/auth/signup", { method: "POST", body: { email, password } });
    const signupCookie = signup.setCookie ?? "";
    const signupRawToken = cookieValue(signupCookie);
    add("Signup returns sanitized user and secure session cookie", signup.status === 201 && hasCookieSecurity(signupCookie) && bodyText(signup.body).includes(prefix) && !bodyText(signup.body).includes("passwordHash") && !bodyText(signup.body).includes("sessionTokenHash"));
    add("Signup persists only session token hash", signupRawToken.length > 30 && await sessionHashForCookie(signupRawToken) !== null && !bodyText(signup.body).includes(signupRawToken));
    add("Needs onboarding is true without membership", (signup.body as { needsOnboarding?: unknown }).needsOnboarding === true);

    const duplicateSignup = await request(baseUrl, "/api/auth/signup", { method: "POST", body: { email: `${prefix}@EXAMPLE.com`, password: "An0ther!Phase9D" } });
    add("Duplicate signup maps to 409", duplicateSignup.status === 409);

    const wrongPassword = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password: "Wr0ng!Phase9D" } });
    const unknownEmail = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email: `${prefix}_missing@example.com`, password } });
    add("Wrong password and unknown email are generic 401 failures", wrongPassword.status === 401 && unknownEmail.status === 401 && bodyText(wrongPassword.body) === bodyText(unknownEmail.body));

    const login = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } });
    const loginCookie = login.setCookie ?? "";
    const loginRawToken = cookieValue(loginCookie);
    add("Login returns secure session cookie", login.status === 200 && hasCookieSecurity(loginCookie));
    add("New login creates a fresh session token", loginRawToken !== signupRawToken && await sessionHashForCookie(loginRawToken) !== null);
    add("No raw token or hash is returned in login response", !bodyText(login.body).includes(loginRawToken) && !bodyText(login.body).includes("sessionTokenHash") && !bodyText(login.body).includes("passwordHash"));

    const me = await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(loginCookie) });
    add("Me with valid session returns sanitized user", me.status === 200 && (me.body as { user?: { emailNormalized?: string } }).user?.emailNormalized === email && !bodyText(me.body).includes("passwordHash"));
    add("Me without cookie returns 401", (await request(baseUrl, "/api/auth/me")).status === 401);
    add("Malformed cookie returns 401", (await request(baseUrl, "/api/auth/me", { cookie: `${AUTH_COOKIE_NAME}=not-a-valid-token` })).status === 401);
    add("Unknown session returns 401", (await request(baseUrl, "/api/auth/me", { cookie: `${AUTH_COOKIE_NAME}=${Buffer.from(randomUUID()).toString("base64url")}` })).status === 401);

    const user = await repository.findUserByEmail(email);
    if (!user) throw new Error("Phase 9D user missing.");
    await executeDatabaseQuery({ text: "UPDATE auth_sessions SET created_at = NOW() - INTERVAL '2 seconds', expires_at = NOW() - INTERVAL '1 second' WHERE session_token_hash = $1", values: [hashOpaqueToken(signupRawToken)] });
    add("Expired session returns 401", (await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(signupCookie) })).status === 401);

    await repository.setUserStatus(user.userId, "disabled");
    add("Disabled user cannot login or use existing sessions", (await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } })).status === 401 && (await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(loginCookie) })).status === 401);
    await repository.setUserStatus(user.userId, "active");

    const loginAfterEnable = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } });
    const activeCookie = loginAfterEnable.setCookie ?? "";
    const logout = await request(baseUrl, "/api/auth/logout", { method: "POST", cookie: cookieHeader(activeCookie) });
    add("Logout revokes current session and clears matching cookie", logout.status === 204 && Boolean(logout.setCookie) && hasClearCookieSecurity(logout.setCookie!) && (await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(activeCookie) })).status === 401);
    add("Repeated logout is safe", (await request(baseUrl, "/api/auth/logout", { method: "POST", cookie: cookieHeader(activeCookie) })).status === 204);
    add("Revoked session returns 401", (await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(activeCookie) })).status === 401);

    const sellerId = `seller_phase9d_${randomUUID().replace(/-/gu, "")}`;
    sellerIds.push(sellerId);
    await executeDatabaseQuery({ text: "INSERT INTO sellers (seller_id) VALUES ($1)", values: [sellerId] });
    await repository.createSellerMembership({ sellerId, userId: user.userId, role: "OWNER", status: "active" });
    const membershipLogin = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } });
    const membershipMe = await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(membershipLogin.setCookie ?? "") });
    add("Membership list returned safely", membershipMe.status === 200 && (membershipMe.body as { activeMemberships?: unknown[] }).activeMemberships?.[0] !== undefined && !bodyText(membershipMe.body).includes("sessionTokenHash"));
    add("Needs onboarding false with active membership", (membershipMe.body as { needsOnboarding?: unknown }).needsOnboarding === false);

    const verifyKnown = await request(baseUrl, "/api/auth/email-verification/request", { method: "POST", body: { email } });
    const verifyUnknown = await request(baseUrl, "/api/auth/email-verification/request", { method: "POST", body: { email: `${prefix}_unknown@example.com` } });
    add("Verification request remains generic", verifyKnown.status === 202 && verifyUnknown.status === 202 && bodyText(verifyKnown.body) === bodyText(verifyUnknown.body));
    add("Invalid verification token maps safely", (await request(baseUrl, "/api/auth/email-verification/confirm", { method: "POST", body: { token: "bad-token" } })).status === 400);

    const resetKnown = await request(baseUrl, "/api/auth/password/forgot", { method: "POST", body: { email } });
    const resetUnknown = await request(baseUrl, "/api/auth/password/forgot", { method: "POST", body: { email: `${prefix}_unknown@example.com` } });
    add("Password reset request remains generic", resetKnown.status === 202 && resetUnknown.status === 202 && bodyText(resetKnown.body) === bodyText(resetUnknown.body));
    add("Invalid reset token maps safely", (await request(baseUrl, "/api/auth/password/reset", { method: "POST", body: { token: "bad-token", newPassword: "N3w!Phase9DPassword" } })).status === 400);

    const resetSessionA = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } });
    const resetSessionB = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } });
    await request(baseUrl, "/api/auth/password/forgot", { method: "POST", body: { email } });
    const resetToken = emailSender.resets.at(-1)?.resetToken;
    const resetResponse = await request(baseUrl, "/api/auth/password/reset", { method: "POST", body: { token: resetToken, newPassword: "N3w!Phase9DPassword" } });
    add("Password reset route succeeds without exposing token", resetResponse.status === 200 && !bodyText(resetResponse.body).includes(String(resetToken)));
    add("Session revocation after password reset remains valid", (await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(resetSessionA.setCookie ?? "") })).status === 401 && (await request(baseUrl, "/api/auth/me", { cookie: cookieHeader(resetSessionB.setCookie ?? "") })).status === 401);

    const { server: fullServer, baseUrl: fullBaseUrl } = await startServer(app);
    try {
      const whatsappWebhook = await request(fullBaseUrl, "/api/whatsapp/cloud/webhook");
      add("Auth middleware is not applied to WhatsApp webhook", whatsappWebhook.status !== 401);
    } finally {
      await stopServer(fullServer);
    }
  } finally {
    await stopServer(server);
    await cleanup(prefix, sellerIds);
    add("Phase 9D rows are cleaned up", (await userIdsByPrefix(prefix)).length === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9D auth sessions HTTP test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
