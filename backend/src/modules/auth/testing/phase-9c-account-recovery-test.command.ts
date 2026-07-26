import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { closeDatabasePool, executeDatabaseQuery } from "../../../infrastructure/database";
import { hashOpaqueTokenSha256Hex } from "../../../infrastructure/security/hash";
import { hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import { hashPassword } from "../../../infrastructure/security/password-hashing";
import {
  AccountRecoveryService,
  AuthEmailDeliveryError,
  AuthInvalidCredentialsError,
  AuthInvalidTokenError,
  AuthValidationError,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  type AuthEmailSender,
  type AuthEmailVerificationMessage,
  type AuthRepositories,
  type AuthSession,
  type AuthUser,
  type PasswordResetToken,
  type RepositoryOptions,
} from "../index";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;

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

class FakeAuthEmailSender implements AuthEmailSender {
  readonly verifications: AuthEmailVerificationMessage[] = [];
  readonly resets: Readonly<{ emailNormalized: string; resetToken: string; expiresAt: Date }>[] = [];

  async sendEmailVerification(message: AuthEmailVerificationMessage): Promise<void> {
    this.verifications.push(message);
  }

  async sendPasswordReset(message: Readonly<{ emailNormalized: string; resetToken: string; expiresAt: Date }>): Promise<void> {
    this.resets.push(message);
  }
}

class FailingAuthEmailSender extends FakeAuthEmailSender {
  async sendPasswordReset(message: Readonly<{ emailNormalized: string; resetToken: string; expiresAt: Date }>): Promise<void> {
    await super.sendPasswordReset(message);
    throw new Error("forced email failure");
  }
}

class FailingResetRepository extends PostgreSqlAuthRepository implements AuthRepositories {
  async markPasswordResetTokenUsed(_tokenId: string, _usedAt: Date, _options?: RepositoryOptions): Promise<PasswordResetToken> {
    throw new Error("forced reset transaction failure");
  }
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
  if (!userIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
}

async function tokenHashExists(tableName: "email_verification_tokens" | "password_reset_tokens", tokenHash: string): Promise<boolean> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE token_hash = $1`,
    values: [tokenHash],
  });
  return result.rows[0]?.count === "1";
}

async function activeTokenCount(tableName: "email_verification_tokens" | "password_reset_tokens", userId: string): Promise<number> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
    values: [userId],
  });
  return Number(result.rows[0]?.count ?? "0");
}

async function expireToken(tableName: "email_verification_tokens" | "password_reset_tokens", tokenHash: string): Promise<void> {
  await executeDatabaseQuery({
    text: `UPDATE ${tableName} SET created_at = NOW() - INTERVAL '2 hours', expires_at = NOW() - INTERVAL '1 hour' WHERE token_hash = $1`,
    values: [tokenHash],
  });
}

async function activeSessionRows(userId: string): Promise<readonly AuthSession[]> {
  const repository = new PostgreSqlAuthRepository();
  const result = await executeDatabaseQuery<{ session_token_hash: string }>({
    text: "SELECT session_token_hash FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at ASC",
    values: [userId],
  });
  const sessions = await Promise.all(result.rows.map((row) => repository.findSessionByTokenHash(row.session_token_hash)));
  return sessions.filter((session): session is AuthSession => session !== null);
}

async function createSession(repository: PostgreSqlAuthRepository, userId: string, label: string): Promise<AuthSession> {
  return repository.createSession({
    sessionId: `session_${label}_${randomUUID().replace(/-/gu, "")}`,
    userId,
    sessionTokenHash: hashOpaqueTokenSha256Hex(`${userId}:${label}:${randomUUID()}`),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

async function main(): Promise<void> {
  const prefix = `phase9c_${randomUUID().replace(/-/gu, "")}`;
  await cleanup(prefix);

  const repository = new PostgreSqlAuthRepository();
  const emailSender = new FakeAuthEmailSender();
  const recovery = new AccountRecoveryService(repository, emailSender);
  const passwordAuth = new PasswordAuthService(repository);
  const originalPassword = "Str0ng!Phase9C";
  const newPassword = "N3w!Phase9CPassword";

  let user: AuthUser | undefined;

  try {
    user = (await passwordAuth.signup({ email: `${prefix}@example.com`, password: originalPassword })).user;

    const verificationRequest = await recovery.requestEmailVerification({ email: `${prefix}@EXAMPLE.com` });
    const verificationToken = emailSender.verifications.at(-1)?.verificationToken;
    const verificationHash = verificationToken ? hashOpaqueToken(verificationToken) : null;
    add("Verification token is issued without returning secrets", verificationRequest.accepted === true && !("verificationToken" in verificationRequest) && typeof verificationToken === "string");
    add("Verification token persists only as a hash", Boolean(verificationHash) && await tokenHashExists("email_verification_tokens", verificationHash!) && verificationHash !== verificationToken);

    await recovery.requestEmailVerification({ email: `${prefix}@example.com` });
    add("Prior unused verification token is invalidated", verificationToken !== undefined && await expectsError(() => recovery.confirmEmailVerification({ token: verificationToken }), AuthInvalidTokenError) && await activeTokenCount("email_verification_tokens", user.userId) === 1);
    const activeVerificationToken = emailSender.verifications.at(-1)!.verificationToken;
    await recovery.confirmEmailVerification({ token: activeVerificationToken });
    add("Email verification succeeds and marks token used", (await repository.findUserById(user.userId))?.emailVerifiedAt instanceof Date && await activeTokenCount("email_verification_tokens", user.userId) === 0);
    add("Invalid verification token is rejected safely", await expectsError(() => recovery.confirmEmailVerification({ token: "not-a-real-token" }), AuthInvalidTokenError));
    add("Already-used verification token is rejected safely", await expectsError(() => recovery.confirmEmailVerification({ token: activeVerificationToken }), AuthInvalidTokenError));

    await recovery.requestEmailVerification({ email: `${prefix}@example.com` });
    const expiredVerificationToken = emailSender.verifications.at(-1)!.verificationToken;
    const expiredVerificationHash = hashOpaqueToken(expiredVerificationToken)!;
    await expireToken("email_verification_tokens", expiredVerificationHash);
    add("Expired verification token is rejected safely", await expectsError(() => recovery.confirmEmailVerification({ token: expiredVerificationToken }), AuthInvalidTokenError));
    const beforeUnknownVerificationEmails = emailSender.verifications.length;
    add("Verification request for unknown email is generic", (await recovery.requestEmailVerification({ email: `${prefix}_unknown@example.com` })).accepted === true && emailSender.verifications.length === beforeUnknownVerificationEmails);

    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    const resetToken = emailSender.resets.at(-1)?.resetToken;
    const resetHash = resetToken ? hashOpaqueToken(resetToken) : null;
    add("Reset token is issued without returning secrets", typeof resetToken === "string" && resetHash !== resetToken);
    add("Reset token persists only as a hash", Boolean(resetHash) && await tokenHashExists("password_reset_tokens", resetHash!));
    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    add("Prior unused reset token is invalidated", resetToken !== undefined && await expectsError(() => recovery.confirmPasswordReset({ token: resetToken, newPassword }), AuthInvalidTokenError) && await activeTokenCount("password_reset_tokens", user.userId) === 1);

    const sessionA = await createSession(repository, user.userId, "a");
    const sessionB = await createSession(repository, user.userId, "b");
    const activeResetToken = emailSender.resets.at(-1)!.resetToken;
    await recovery.confirmPasswordReset({ token: activeResetToken, newPassword });
    add("Password reset succeeds and marks token used", await activeTokenCount("password_reset_tokens", user.userId) === 0);
    add("New password login succeeds", (await passwordAuth.login({ email: `${prefix}@example.com`, password: newPassword })).user.userId === user.userId);
    add("Old password login fails", await expectsError(() => passwordAuth.login({ email: `${prefix}@example.com`, password: originalPassword }), AuthInvalidCredentialsError));
    add("All active user sessions are revoked after reset", (await repository.findSessionByTokenHash(sessionA.sessionTokenHash))?.revokedAt instanceof Date && (await repository.findSessionByTokenHash(sessionB.sessionTokenHash))?.revokedAt instanceof Date && (await activeSessionRows(user.userId)).length === 0);

    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    const weakResetToken = emailSender.resets.at(-1)!.resetToken;
    add("Weak replacement password is rejected", await expectsError(() => recovery.confirmPasswordReset({ token: weakResetToken, newPassword: "weak" }), AuthValidationError));
    add("Excessively long replacement password is rejected", await expectsError(() => recovery.confirmPasswordReset({ token: weakResetToken, newPassword: `Aa1!${"x".repeat(253)}` }), AuthValidationError));
    add("Invalid reset token is rejected safely", await expectsError(() => recovery.confirmPasswordReset({ token: "unknown-token", newPassword }), AuthInvalidTokenError));

    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    const expiredResetToken = emailSender.resets.at(-1)!.resetToken;
    await expireToken("password_reset_tokens", hashOpaqueToken(expiredResetToken)!);
    add("Expired reset token is rejected safely", await expectsError(() => recovery.confirmPasswordReset({ token: expiredResetToken, newPassword }), AuthInvalidTokenError));

    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    const usedResetToken = emailSender.resets.at(-1)!.resetToken;
    await recovery.confirmPasswordReset({ token: usedResetToken, newPassword: "An0ther!Phase9CPassword" });
    add("Used reset token is rejected safely", await expectsError(() => recovery.confirmPasswordReset({ token: usedResetToken, newPassword }), AuthInvalidTokenError));

    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    const concurrentToken = emailSender.resets.at(-1)!.resetToken;
    const concurrentResults = await Promise.allSettled([
      recovery.confirmPasswordReset({ token: concurrentToken, newPassword: "C0ncurrent!Phase9COne" }),
      recovery.confirmPasswordReset({ token: concurrentToken, newPassword: "C0ncurrent!Phase9CTwo" }),
    ]);
    add("Concurrent double-use of the same reset token cannot both succeed", concurrentResults.filter((result) => result.status === "fulfilled").length === 1 && concurrentResults.filter((result) => result.status === "rejected" && result.reason instanceof AuthInvalidTokenError).length === 1);

    const failingEmailSender = new FailingAuthEmailSender();
    const failingEmailRecovery = new AccountRecoveryService(repository, failingEmailSender);
    add("Email sender failure is typed after token commit", await expectsError(() => failingEmailRecovery.requestPasswordReset({ email: `${prefix}@example.com` }), AuthEmailDeliveryError) && failingEmailSender.resets.length === 1 && await tokenHashExists("password_reset_tokens", hashOpaqueToken(failingEmailSender.resets[0]!.resetToken)!));
    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    add("Later request safely replaces token after delivery failure", await expectsError(() => recovery.confirmPasswordReset({ token: failingEmailSender.resets[0]!.resetToken, newPassword }), AuthInvalidTokenError) && await activeTokenCount("password_reset_tokens", user.userId) === 1);

    await recovery.requestPasswordReset({ email: `${prefix}@example.com` });
    const rollbackToken = emailSender.resets.at(-1)!.resetToken;
    const rollbackHash = hashOpaqueToken(rollbackToken)!;
    const passwordBeforeRollback = (await repository.findPasswordCredentialByUserId(user.userId))!.passwordHash;
    const rollbackSession = await createSession(repository, user.userId, "rollback");
    const failingRecovery = new AccountRecoveryService(new FailingResetRepository(), emailSender);
    add("Transaction rollback leaves password token and session state unchanged", await expectsError(() => failingRecovery.confirmPasswordReset({ token: rollbackToken, newPassword }), Error) && (await repository.findPasswordCredentialByUserId(user.userId))?.passwordHash === passwordBeforeRollback && (await repository.findPasswordResetTokenByHash(rollbackHash))?.usedAt === undefined && (await repository.findSessionByTokenHash(rollbackSession.sessionTokenHash))?.revokedAt === undefined);

    await repository.setUserStatus(user.userId, "disabled");
    const beforeDisabledVerificationEmails = emailSender.verifications.length;
    const beforeDisabledResetEmails = emailSender.resets.length;
    add("Disabled users do not receive usable verification or reset flows", (await recovery.requestEmailVerification({ email: `${prefix}@example.com` })).accepted === true && (await recovery.requestPasswordReset({ email: `${prefix}@example.com` })).accepted === true && emailSender.verifications.length === beforeDisabledVerificationEmails && emailSender.resets.length === beforeDisabledResetEmails);
    add("Disabled users cannot confirm existing recovery tokens", await expectsError(() => recovery.confirmPasswordReset({ token: rollbackToken, newPassword }), AuthInvalidTokenError));

    add("Recovery flows do not return hashes credentials or raw tokens", !("tokenHash" in verificationRequest) && !("passwordHash" in verificationRequest));
  } finally {
    await cleanup(prefix);
    add("Phase 9C PostgreSQL rows are cleaned up", (await userIdsByPrefix(prefix)).length === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9C account recovery test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
