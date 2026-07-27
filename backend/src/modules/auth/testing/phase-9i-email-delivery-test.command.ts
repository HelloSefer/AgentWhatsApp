import { createServer, type RequestListener, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { env } from "../../../config/env";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import { hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import { PasswordAuthService, PostgreSqlAuthRepository, SmtpAuthEmailConfigurationError, SmtpAuthEmailSender, type AuthEmailSender, type AuthEmailVerificationMessage } from "../index";
import { createAuthRoutes } from "../auth.routes";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";

type TestCase = Readonly<{ name: string; passed: boolean }>;
type SentMail = Readonly<{ from?: unknown; to?: unknown; subject?: unknown; text?: unknown; html?: unknown }>;
type HttpResponse = Readonly<{ status: number; text: string; body?: unknown }>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

async function expectsError(callback: () => Promise<unknown>, expected: new (...args: never[]) => Error): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof expected;
  }
}

function baseConfig(overrides: Partial<ConstructorParameters<typeof SmtpAuthEmailSender>[0]> = {}): ConstructorParameters<typeof SmtpAuthEmailSender>[0] {
  return {
    host: "smtp.example.invalid",
    port: 587,
    secure: false,
    user: "sender@example.invalid",
    password: "smtp-test-password",
    fromName: "AgentWhatsApp",
    fromAddress: "sender@example.invalid",
    frontendBaseUrl: "https://app.example.invalid",
    ...overrides,
  };
}

function fakeTransport(sent: SentMail[], counters: { created: number; verified: number }) {
  return () => {
    counters.created += 1;
    return {
      verify: async () => {
        counters.verified += 1;
        return true;
      },
      sendMail: async (mail: SentMail) => {
        sent.push(mail);
        return { accepted: ["redacted"], rejected: [] };
      },
    } as never;
  };
}

async function userIdsByPrefix(prefix: string): Promise<readonly string[]> {
  const result = await executeDatabaseQuery<{ user_id: string }>({
    text: "SELECT user_id FROM auth_users WHERE email_normalized LIKE $1",
    values: [`${prefix}%@example.com`],
  });
  return result.rows.map((row) => row.user_id);
}

async function cleanup(prefix: string): Promise<void> {
  const userIds = await userIdsByPrefix(prefix);
  if (userIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
  }
}

async function tokenHashExists(tableName: "email_verification_tokens" | "password_reset_tokens", tokenHash: string): Promise<boolean> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE token_hash = $1`,
    values: [tokenHash],
  });
  return result.rows[0]?.count === "1";
}

async function expireToken(tableName: "email_verification_tokens" | "password_reset_tokens", tokenHash: string): Promise<void> {
  await executeDatabaseQuery({
    text: `UPDATE ${tableName} SET created_at = NOW() - INTERVAL '2 hours', expires_at = NOW() - INTERVAL '1 hour' WHERE token_hash = $1`,
    values: [tokenHash],
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

async function request(baseUrl: string, path: string, input: Readonly<{ method?: string; body?: unknown }> = {}): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method ?? "GET",
    headers: input.body === undefined ? undefined : { "content-type": "application/json" },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, text, body };
}

class CapturingEmailSender implements AuthEmailSender {
  readonly verifications: AuthEmailVerificationMessage[] = [];
  readonly resets: Readonly<{ emailNormalized: string; resetToken: string; expiresAt: Date }>[] = [];

  async sendEmailVerification(message: AuthEmailVerificationMessage): Promise<void> {
    this.verifications.push(message);
  }

  async sendPasswordReset(message: Readonly<{ emailNormalized: string; resetToken: string; expiresAt: Date }>): Promise<void> {
    this.resets.push(message);
  }
}

async function runDeterministicAdapterTests(): Promise<void> {
  const sent: SentMail[] = [];
  const counters = { created: 0, verified: 0 };
  const sender = new SmtpAuthEmailSender(baseConfig(), fakeTransport(sent, counters));
  add("SMTP sender construction is lazy", counters.created === 0 && counters.verified === 0);
  add("SMTP import does not initialize database or SMTP", !getDatabasePoolState().initialized && counters.created === 0);

  const verificationToken = "verification_raw_token";
  const resetToken = "reset_raw_token";
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");
  await sender.sendEmailVerification({ emailNormalized: "recipient@example.invalid", verificationToken, expiresAt });
  await sender.sendPasswordReset({ emailNormalized: "recipient@example.invalid", resetToken, expiresAt });
  add("SMTP transport is reused lazily", counters.created === 1 && sent.length === 2);

  const verification = sent[0];
  const reset = sent[1];
  add("Verification email subject is professional", verification?.subject === "Verify your AgentWhatsApp email");
  add("Verification email HTML includes safe URL", typeof verification?.html === "string" && verification.html.includes("https://app.example.invalid/verify-email?token=verification_raw_token") && verification.html.includes("Verify email"));
  add("Verification email text includes safe URL", typeof verification?.text === "string" && verification.text.includes("https://app.example.invalid/verify-email?token=verification_raw_token"));
  add("Reset email subject is professional", reset?.subject === "Reset your AgentWhatsApp password");
  add("Reset email HTML includes safe URL", typeof reset?.html === "string" && reset.html.includes("https://app.example.invalid/reset-password?token=reset_raw_token") && reset.html.includes("Reset password"));
  add("Reset email text includes safe URL", typeof reset?.text === "string" && reset.text.includes("https://app.example.invalid/reset-password?token=reset_raw_token"));

  const missingConfigSender = new SmtpAuthEmailSender(baseConfig({ password: "", frontendBaseUrl: "" }), fakeTransport([], { created: 0, verified: 0 }));
  add("Invalid SMTP configuration fails without exposing values", await expectsError(() => missingConfigSender.sendPasswordReset({ emailNormalized: "recipient@example.invalid", resetToken: "secret-token", expiresAt }), SmtpAuthEmailConfigurationError));
  try {
    await missingConfigSender.sendPasswordReset({ emailNormalized: "recipient@example.invalid", resetToken: "secret-token", expiresAt });
  } catch (error) {
    add("SMTP configuration error is sanitized", error instanceof Error && !error.message.includes("secret-token") && !error.message.includes("smtp-test-password"));
  }
}

async function runHttpAndRecoveryTests(): Promise<void> {
  const prefix = `phase9i_${randomUUID().replace(/-/gu, "")}`;
  await cleanup(prefix);
  const repository = new PostgreSqlAuthRepository();
  const passwordAuth = new PasswordAuthService(repository);
  const emailSender = new CapturingEmailSender();
  const composition = createAuthComposition(emailSender);
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRoutes(composition));
  const { server, baseUrl } = await startServer(app);

  try {
    const unknownForgot = await request(baseUrl, "/api/auth/password/forgot", { method: "POST", body: { email: `${prefix}_unknown@example.com` } });
    const unknownVerification = await request(baseUrl, "/api/auth/email-verification/request", { method: "POST", body: { email: `${prefix}_unknown@example.com` } });
    add("Unknown email HTTP recovery remains generic", unknownForgot.status === 202 && unknownVerification.status === 202 && emailSender.resets.length === 0 && emailSender.verifications.length === 0);

    const userEmail = `${prefix}@example.com`;
    await passwordAuth.signup({ email: userEmail, password: "Str0ng!Phase9I" });
    const verificationResponse = await request(baseUrl, "/api/auth/email-verification/request", { method: "POST", body: { email: userEmail } });
    const verificationToken = emailSender.verifications.at(-1)?.verificationToken;
    const verificationHash = verificationToken ? hashOpaqueToken(verificationToken) : null;
    add("Verification HTTP response does not return raw token", verificationResponse.status === 202 && !verificationResponse.text.includes(verificationToken ?? "missing"));
    add("Verification token persists only as hash", Boolean(verificationHash) && verificationHash !== verificationToken && await tokenHashExists("email_verification_tokens", verificationHash!));
    add("Verification token is one-time", verificationToken !== undefined && (await request(baseUrl, "/api/auth/email-verification/confirm", { method: "POST", body: { token: verificationToken } })).status === 200 && (await request(baseUrl, "/api/auth/email-verification/confirm", { method: "POST", body: { token: verificationToken } })).status === 400);

    await request(baseUrl, "/api/auth/password/forgot", { method: "POST", body: { email: userEmail } });
    const resetToken = emailSender.resets.at(-1)?.resetToken;
    const resetHash = resetToken ? hashOpaqueToken(resetToken) : null;
    add("Reset token persists only as hash", Boolean(resetHash) && resetHash !== resetToken && await tokenHashExists("password_reset_tokens", resetHash!));
    await expireToken("password_reset_tokens", resetHash!);
    add("Expired reset token is rejected", resetToken !== undefined && (await request(baseUrl, "/api/auth/password/reset", { method: "POST", body: { token: resetToken, newPassword: "An0ther!Phase9I" } })).status === 400);

    const failingSender: AuthEmailSender = {
      sendEmailVerification: async () => {
        throw new Error("smtp failure with hidden details");
      },
      sendPasswordReset: async () => {
        throw new Error("smtp failure with hidden details");
      },
    };
    const failingApp = express();
    failingApp.use(express.json());
    failingApp.use("/api/auth", createAuthRoutes(createAuthComposition(failingSender)));
    const { server: failingServer, baseUrl: failingBaseUrl } = await startServer(failingApp);
    try {
      const failure = await request(failingBaseUrl, "/api/auth/password/forgot", { method: "POST", body: { email: userEmail } });
      add("SMTP failure maps to sanitized delivery error", failure.status === 503 && failure.text.includes("Email delivery failed.") && !failure.text.includes("smtp failure"));
    } finally {
      await stopServer(failingServer);
    }
  } finally {
    await stopServer(server);
    await cleanup(prefix);
    add("Phase 9I database rows are cleaned up", (await userIdsByPrefix(prefix)).length === 0);
  }
}

async function runLiveSmtpAcceptance(): Promise<void> {
  const sender = new SmtpAuthEmailSender({
    host: env.authEmailSmtpHost,
    port: env.authEmailSmtpPort,
    secure: env.authEmailSmtpSecure,
    user: env.authEmailSmtpUser,
    password: env.authEmailSmtpPassword,
    fromName: env.authEmailFromName,
    fromAddress: env.authEmailFromAddress,
    frontendBaseUrl: env.frontendBaseUrl,
    subjectPrefix: "[AgentWhatsApp DEV TEST] ",
  });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  try {
    await sender.verifyConnection();
    add("Live SMTP connection accepted", true);
  } catch {
    add("Live SMTP connection accepted", false);
    return;
  }

  try {
    await sender.sendEmailVerification({ emailNormalized: env.authEmailSmtpUser, verificationToken: `dev_verify_${randomUUID().replace(/-/gu, "")}`, expiresAt });
    add("Live verification test email accepted", true);
  } catch {
    add("Live verification test email accepted", false);
  }

  try {
    await sender.sendPasswordReset({ emailNormalized: env.authEmailSmtpUser, resetToken: `dev_reset_${randomUUID().replace(/-/gu, "")}`, expiresAt });
    add("Live password-reset test email accepted", true);
  } catch {
    add("Live password-reset test email accepted", false);
  }
}

async function main(): Promise<void> {
  try {
    await runDeterministicAdapterTests();
    await runHttpAndRecoveryTests();
    await runLiveSmtpAcceptance();
  } finally {
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9I email delivery test failed safely.", error: error instanceof Error ? error.message : "Unknown error" })}\n`);
  process.exitCode = 1;
});
