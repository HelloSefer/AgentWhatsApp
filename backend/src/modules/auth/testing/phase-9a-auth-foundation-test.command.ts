import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  DatabaseQueryError,
  executeDatabaseQuery,
  getDatabasePoolState,
  withTransaction,
  type DatabaseQueryExecutor,
  type ParameterizedQuery,
} from "../../../infrastructure/database";
import { hashOpaqueTokenSha256Hex, timingSafeOpaqueTokenHashEqual } from "../../../infrastructure/security/hash";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import {
  AuthAlreadyExistsError,
  AuthNotFoundError,
  AuthValidationError,
  normalizeEmail,
  PostgreSqlAuthRepository,
  validateAuthRole,
  validateAuthStatus,
  validateAuthId,
  validateHash,
  validateOpaqueTokenHash,
  validateSellerMembershipSellerId,
} from "../index";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type Row = Record<string, unknown>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

async function expectsError(callback: () => Promise<unknown> | unknown, expected: new (...args: never[]) => Error): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof expected;
  }
}

async function expectsAnyError(callback: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch {
    return true;
  }
}

function now(): Date {
  return new Date("2026-07-26T12:00:00.000Z");
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

class FakeExecutor implements DatabaseQueryExecutor {
  readonly queries: ParameterizedQuery[] = [];
  duplicate = false;
  empty = false;

  async execute<R extends Row = Row>(query: ParameterizedQuery): Promise<{ rows: readonly R[]; rowCount: number }> {
    this.queries.push(query);
    if (this.duplicate) {
      const cause = Object.assign(new Error("duplicate"), { code: "23505" });
      throw new DatabaseQueryError(cause);
    }
    if (this.empty) return { rows: [], rowCount: 0 };

    const text = query.text;
    const values = query.values ?? [];
    const createdAt = now();
    const row = (() => {
      if (text.includes("auth_users")) return { user_id: values[0] ?? "user", email_normalized: text.includes("email_normalized = $1") ? values[0] : values[1] ?? "person@example.com", status: text.includes("SET status") ? values[1] : values[2] ?? "active", email_verified_at: text.startsWith("UPDATE") && text.includes("SET email_verified_at") ? values[1] : null, created_at: createdAt, updated_at: createdAt };
      if (text.includes("password_credentials")) return { user_id: values[0], password_hash: values[1] ?? "hash", created_at: createdAt, updated_at: createdAt };
      if (text.includes("external_identities")) return { external_identity_id: values[0] ?? "identity", user_id: values[1] ?? "user", provider: values[2] ?? "google", provider_subject: values[3] ?? "subject", email_normalized: values[4] ?? null, created_at: createdAt, updated_at: createdAt };
      if (text.includes("auth_sessions")) return { session_id: values[0] ?? "session", user_id: values[1] ?? "user", session_token_hash: text.includes("session_token_hash = $1") ? values[0] : values[2] ?? "hash", created_at: createdAt, expires_at: values[3] ?? new Date("2026-07-27T12:00:00.000Z"), last_seen_at: null, revoked_at: text.startsWith("UPDATE") ? values[1] : null };
      if (text.includes("email_verification_tokens")) return { token_id: values[0] ?? "token", user_id: values[1] ?? "user", token_hash: text.includes("token_hash = $1") ? values[0] : values[2] ?? "hash", email_normalized: values[3] ?? "person@example.com", created_at: createdAt, expires_at: values[4] ?? new Date("2026-07-27T12:00:00.000Z"), used_at: text.startsWith("UPDATE") && text.includes("SET used_at") ? values[1] : null, revoked_at: text.startsWith("UPDATE") && text.includes("SET revoked_at") ? values[1] : null };
      if (text.includes("password_reset_tokens")) return { token_id: values[0] ?? "token", user_id: values[1] ?? "user", token_hash: text.includes("token_hash = $1") ? values[0] : values[2] ?? "hash", created_at: createdAt, expires_at: values[3] ?? new Date("2026-07-27T12:00:00.000Z"), used_at: text.startsWith("UPDATE") && text.includes("SET used_at") ? values[1] : null, revoked_at: text.startsWith("UPDATE") && text.includes("SET revoked_at") ? values[1] : null };
      if (text.includes("seller_memberships")) return { seller_id: values[0] ?? "seller", user_id: values[1] ?? "user", role: text.includes("SET role") || text.includes("INSERT") ? values[2] : "OWNER", status: text.includes("SET status") ? values[2] : text.includes("INSERT") ? values[3] : "active", created_at: createdAt, updated_at: createdAt, disabled_at: text.includes("SET status") && values[2] === "disabled" ? values[3] : values[3] === "disabled" ? createdAt : null };
      return {};
    })();
    return { rows: [row as R], rowCount: 1 };
  }
}

async function countRows(tableName: string, columnName: string, values: readonly string[]): Promise<number> {
  if (!values.length) return 0;
  const result = await executeDatabaseQuery<{ count: string }>({
    text: `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE ${columnName} = ANY($1::text[])`,
    values: [values],
  });
  return Number(result.rows[0]?.count ?? "0");
}

async function runPostgreSqlIntegrationAcceptance(): Promise<void> {
  const repository = new PostgreSqlAuthRepository();
  const userIds: string[] = [];
  const sellerIds: string[] = [];
  const emailPrefix = `phase9a_${randomUUID().replace(/-/gu, "")}`;

  async function cleanup(): Promise<void> {
    await executeDatabaseQuery({ text: "DELETE FROM seller_memberships WHERE user_id = ANY($1::text[]) OR seller_id = ANY($2::text[])", values: [userIds, sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM auth_sessions WHERE user_id = ANY($1::text[])", values: [userIds] });
    await executeDatabaseQuery({ text: "DELETE FROM email_verification_tokens WHERE user_id = ANY($1::text[])", values: [userIds] });
    await executeDatabaseQuery({ text: "DELETE FROM password_reset_tokens WHERE user_id = ANY($1::text[])", values: [userIds] });
    await executeDatabaseQuery({ text: "DELETE FROM external_identities WHERE user_id = ANY($1::text[])", values: [userIds] });
    await executeDatabaseQuery({ text: "DELETE FROM password_credentials WHERE user_id = ANY($1::text[])", values: [userIds] });
    await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  }

  const userId = uniqueId("auth_user_phase9a");
  const transactionUserId = uniqueId("auth_tx_phase9a");
  const rollbackUserId = uniqueId("auth_rollback_phase9a");
  const sellerId = uniqueId("seller_phase9a");
  userIds.push(userId, transactionUserId, rollbackUserId);
  sellerIds.push(sellerId);

  try {
    const user = await repository.createUser({ userId, emailNormalized: ` ${emailPrefix}@Example.COM `, status: "active" });
    add("PostgreSQL creates auth user with normalized email", user.emailNormalized === `${emailPrefix}@example.com`);
    add("PostgreSQL finds auth user by normalized email", (await repository.findUserByEmail(` ${emailPrefix.toUpperCase()}@EXAMPLE.COM `))?.userId === userId);
    add("PostgreSQL enforces case-insensitive email uniqueness", await expectsError(() => repository.createUser({ userId: uniqueId("auth_dupe_phase9a"), emailNormalized: `${emailPrefix}@EXAMPLE.com`, status: "active" }), AuthAlreadyExistsError));

    const firstPasswordHash = "$phase9a$password-hash-one";
    const secondPasswordHash = "$phase9a$password-hash-two";
    await repository.upsertPasswordCredential({ userId, passwordHash: firstPasswordHash });
    await repository.upsertPasswordCredential({ userId, passwordHash: secondPasswordHash });
    const passwordRows = await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM password_credentials WHERE user_id = $1", values: [userId] });
    add("PostgreSQL keeps one password credential per user", passwordRows.rows[0]?.count === "1" && (await repository.findPasswordCredentialByUserId(userId))?.passwordHash === secondPasswordHash);

    await repository.createExternalIdentity({ externalIdentityId: uniqueId("external_phase9a"), userId, provider: "Google", providerSubject: "provider-subject", emailNormalized: `${emailPrefix}@example.com` });
    add("PostgreSQL enforces external identity provider subject uniqueness", await expectsError(() => repository.createExternalIdentity({ externalIdentityId: uniqueId("external_phase9a"), userId, provider: "google", providerSubject: "provider-subject" }), AuthAlreadyExistsError));
    add("PostgreSQL external identity lookup uses provider subject", (await repository.findExternalIdentity("GOOGLE", "provider-subject"))?.userId === userId);

    add("PostgreSQL rejects raw or malformed token hashes", await expectsError(() => repository.createSession({ sessionId: uniqueId("session_phase9a"), userId, sessionTokenHash: "raw-token", expiresAt: new Date(Date.now() + 60_000) }), AuthValidationError));
    const sessionHash = hashOpaqueTokenSha256Hex(`${userId}:session`);
    const sessionExpiresAt = new Date(Date.now() + 3_600_000);
    const session = await repository.createSession({ sessionId: uniqueId("session_phase9a"), userId, sessionTokenHash: sessionHash, expiresAt: sessionExpiresAt });
    const revoked = await repository.revokeSession(session.sessionId, now());
    add("PostgreSQL creates and finds sessions by token hash", (await repository.findSessionByTokenHash(sessionHash))?.sessionId === session.sessionId);
    add("PostgreSQL persists session expiration and revocation", session.expiresAt.getTime() === sessionExpiresAt.getTime() && revoked.revokedAt?.getTime() === now().getTime());

    const verification = await repository.createEmailVerificationToken({ tokenId: uniqueId("verify_phase9a"), userId, tokenHash: hashOpaqueTokenSha256Hex(`${userId}:verify`), emailNormalized: `${emailPrefix}@example.com`, expiresAt: sessionExpiresAt });
    const usedVerification = await repository.markEmailVerificationTokenUsed(verification.tokenId, now());
    add("PostgreSQL email verification tokens support expiration and one-time use", verification.expiresAt.getTime() === sessionExpiresAt.getTime() && usedVerification.usedAt?.getTime() === now().getTime());

    const reset = await repository.createPasswordResetToken({ tokenId: uniqueId("reset_phase9a"), userId, tokenHash: hashOpaqueTokenSha256Hex(`${userId}:reset`), expiresAt: sessionExpiresAt });
    const usedReset = await repository.markPasswordResetTokenUsed(reset.tokenId, now());
    add("PostgreSQL password reset tokens support expiration and one-time use", reset.expiresAt.getTime() === sessionExpiresAt.getTime() && usedReset.usedAt?.getTime() === now().getTime());

    await executeDatabaseQuery({ text: "INSERT INTO sellers (seller_id) VALUES ($1)", values: [sellerId] });
    const membership = await repository.createSellerMembership({ sellerId, userId, role: "OWNER", status: "active" });
    add("PostgreSQL creates seller membership for an existing seller", membership.sellerId === sellerId && membership.userId === userId);
    add("PostgreSQL rejects duplicate seller user memberships", await expectsError(() => repository.createSellerMembership({ sellerId, userId, role: "ADMIN", status: "active" }), AuthAlreadyExistsError));
    add("PostgreSQL rejects invalid roles and statuses", await expectsError(() => repository.createSellerMembership({ sellerId, userId, role: "ROOT" as never, status: "active" }), AuthValidationError) && await expectsError(() => repository.setUserStatus(userId, "pending" as never), AuthValidationError));
    add("PostgreSQL rejects default-seller memberships", await expectsError(() => repository.createSellerMembership({ sellerId: "default-seller", userId, role: "OWNER", status: "active" }), AuthValidationError));

    add("PostgreSQL restricts deleting seller with existing membership", await expectsAnyError(() => executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = $1", values: [sellerId] })));

    await withTransaction(async (transaction) => {
      await repository.createUser({ userId: transactionUserId, emailNormalized: `${emailPrefix}_tx@example.com`, status: "active" }, { executor: transaction });
      await repository.upsertPasswordCredential({ userId: transactionUserId, passwordHash: "$phase9a$tx-password-hash" }, { executor: transaction });
      add("PostgreSQL repositories use explicit transaction executors", (await repository.findPasswordCredentialByUserId(transactionUserId, { executor: transaction }))?.userId === transactionUserId);
    });
    add("PostgreSQL committed transaction records are visible after commit", (await repository.findUserById(transactionUserId))?.userId === transactionUserId);

    await expectsAnyError(() => withTransaction(async (transaction) => {
      await repository.createUser({ userId: rollbackUserId, emailNormalized: `${emailPrefix}_rollback@example.com`, status: "active" }, { executor: transaction });
      await repository.upsertPasswordCredential({ userId: rollbackUserId, passwordHash: "$phase9a$rollback-password-hash" }, { executor: transaction });
      await repository.createSession({ sessionId: uniqueId("rollback_session_phase9a"), userId: rollbackUserId, sessionTokenHash: hashOpaqueTokenSha256Hex(`${rollbackUserId}:session`), expiresAt: sessionExpiresAt }, { executor: transaction });
      throw new Error("force rollback");
    }));
    add("PostgreSQL rollback leaves no partial auth records", await repository.findUserById(rollbackUserId) === null && await countRows("password_credentials", "user_id", [rollbackUserId]) === 0 && await countRows("auth_sessions", "user_id", [rollbackUserId]) === 0);

    await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = $1", values: [userId] });
    const orphanCount = await Promise.all([
      countRows("password_credentials", "user_id", [userId]),
      countRows("external_identities", "user_id", [userId]),
      countRows("auth_sessions", "user_id", [userId]),
      countRows("email_verification_tokens", "user_id", [userId]),
      countRows("password_reset_tokens", "user_id", [userId]),
      countRows("seller_memberships", "user_id", [userId]),
    ]);
    add("PostgreSQL deleting a user removes only auth-owned child records", orphanCount.every((count) => count === 0) && (await repository.findUserById(transactionUserId))?.userId === transactionUserId);
  } finally {
    await cleanup();
    const remainingAuthRows = await Promise.all([
      countRows("auth_users", "user_id", userIds),
      countRows("password_credentials", "user_id", userIds),
      countRows("external_identities", "user_id", userIds),
      countRows("auth_sessions", "user_id", userIds),
      countRows("email_verification_tokens", "user_id", userIds),
      countRows("password_reset_tokens", "user_id", userIds),
      countRows("seller_memberships", "user_id", userIds),
    ]);
    const remainingSellers = await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    add("PostgreSQL integration rows are cleaned up", remainingAuthRows.every((count) => count === 0) && remainingSellers.rows[0]?.count === "0");
  }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Auth imports do not initialize the database pool", !getDatabasePoolState().initialized);
  add("Auth composition creates explicit repositories", createAuthComposition().authRepositories instanceof PostgreSqlAuthRepository);
  add("Email normalization trims, lowercases, and validates", normalizeEmail(" PERSON@Example.COM ") === "person@example.com");
  add("Invalid email is rejected", await expectsError(() => normalizeEmail("person"), AuthValidationError));
  add("Auth roles are constrained", validateAuthRole("OWNER") === "OWNER" && validateAuthRole("VIEWER") === "VIEWER");
  add("Invalid role is rejected", await expectsError(() => validateAuthRole("ROOT"), AuthValidationError));
  add("Auth statuses are constrained", validateAuthStatus("active") === "active" && validateAuthStatus("disabled") === "disabled");
  add("Invalid status is rejected", await expectsError(() => validateAuthStatus("pending"), AuthValidationError));
  add("Blank identifiers are rejected", await expectsError(() => validateAuthId(" "), AuthValidationError));
  add("Hash validation accepts nonblank hashes only", validateHash("hash") === "hash" && await expectsError(() => validateHash(" "), AuthValidationError));
  add("Token hash validation rejects raw or malformed token values", await expectsError(() => validateOpaqueTokenHash("raw-token"), AuthValidationError));
  add("Security utility is scoped to opaque-token hashes", hashOpaqueTokenSha256Hex("secret-token").length === 64 && timingSafeOpaqueTokenHashEqual(hashOpaqueTokenSha256Hex("a"), hashOpaqueTokenSha256Hex("a")) && !timingSafeOpaqueTokenHashEqual(hashOpaqueTokenSha256Hex("a"), hashOpaqueTokenSha256Hex("b")));
  add("Seller membership validation reuses TenantContext and rejects default-seller", await expectsAnyError(() => validateSellerMembershipSellerId("Default Seller")));

  const repository = new PostgreSqlAuthRepository();
  const fake = new FakeExecutor();
  const options = { executor: fake };
  const id = `auth_phase9a_${randomUUID().replace(/-/gu, "")}`;
  const hash = hashOpaqueTokenSha256Hex("token");
  const expiresAt = new Date("2026-07-27T12:00:00.000Z");

  const user = await repository.createUser({ userId: id, emailNormalized: " USER@Example.COM ", status: "active" }, options);
  add("User repository creates normalized unique-email records", user.userId === id && user.emailNormalized === "user@example.com");
  await repository.findUserById(id, options);
  await repository.findUserByEmail("user@example.com", options);
  add("User repository supports lookup by id and normalized email", fake.queries.some((query) => query.text.includes("WHERE user_id = $1")) && fake.queries.some((query) => query.text.includes("WHERE email_normalized = $1")));
  add("User status updates support active and disabled", (await repository.setUserStatus(id, "disabled", options)).status === "disabled");
  add("Email verification timestamp can be persisted", (await repository.markEmailVerified(id, now(), options)).emailVerifiedAt instanceof Date);
  add("Password credential stores only hash-shaped input", (await repository.upsertPasswordCredential({ userId: id, passwordHash: hash }, options)).passwordHash === hash);
  add("Password credential can be read by user id", (await repository.findPasswordCredentialByUserId(id, options))?.userId === id);
  add("External identity stores provider plus provider subject", (await repository.createExternalIdentity({ externalIdentityId: `${id}_identity`, userId: id, provider: "Google", providerSubject: "subject", emailNormalized: "USER@example.com" }, options)).provider === "google");
  add("External identity lookup uses provider plus subject", (await repository.findExternalIdentity("google", "subject", options))?.providerSubject === "subject");
  add("External identities list by user", (await repository.listExternalIdentitiesForUser(id, options)).length === 1);
  add("Session stores hashed token with expiry", (await repository.createSession({ sessionId: `${id}_session`, userId: id, sessionTokenHash: hash, expiresAt }, options)).expiresAt.getTime() === expiresAt.getTime());
  add("Session lookup uses token hash only", (await repository.findSessionByTokenHash(hash, options))?.sessionTokenHash === hash);
  add("Session revocation persists revokedAt", (await repository.revokeSession(`${id}_session`, now(), options)).revokedAt instanceof Date);
  add("Email verification token stores hash, expiry, use, and revocation fields", (await repository.createEmailVerificationToken({ tokenId: `${id}_verify`, userId: id, tokenHash: hash, emailNormalized: "USER@example.com", expiresAt }, options)).emailNormalized === "user@example.com");
  add("Email verification token can be found by hash", (await repository.findEmailVerificationTokenByHash(hash, options))?.tokenHash === hash);
  add("Email verification token can be used and revoked", (await repository.markEmailVerificationTokenUsed(`${id}_verify`, now(), options)).usedAt instanceof Date && (await repository.revokeEmailVerificationToken(`${id}_verify`, now(), options)).revokedAt instanceof Date);
  add("Password reset token stores hash, expiry, use, and revocation fields", (await repository.createPasswordResetToken({ tokenId: `${id}_reset`, userId: id, tokenHash: hash, expiresAt }, options)).tokenHash === hash);
  add("Password reset token can be found by hash", (await repository.findPasswordResetTokenByHash(hash, options))?.tokenHash === hash);
  add("Password reset token can be used and revoked", (await repository.markPasswordResetTokenUsed(`${id}_reset`, now(), options)).usedAt instanceof Date && (await repository.revokePasswordResetToken(`${id}_reset`, now(), options)).revokedAt instanceof Date);
  add("Seller membership supports role and active status", (await repository.createSellerMembership({ sellerId: "seller_phase9a", userId: id, role: "OWNER", status: "active" }, options)).role === "OWNER");
  add("Seller membership can be found and listed for users", (await repository.findSellerMembership("seller_phase9a", id, options))?.sellerId === "seller_phase9a" && (await repository.listSellerMembershipsForUser(id, options)).length === 1);
  add("Seller membership can be disabled and role changed", (await repository.setSellerMembershipStatus("seller_phase9a", id, "disabled", now(), options)).disabledAt instanceof Date && (await repository.setSellerMembershipRole("seller_phase9a", id, "ADMIN", options)).role === "ADMIN");
  add("Repository queries are parameterized", fake.queries.every((query) => query.text.includes("$") && !query.text.includes(id)));

  const duplicate = new FakeExecutor();
  duplicate.duplicate = true;
  add("Unique user/email violations map to typed auth duplicate errors", await expectsError(() => repository.createUser({ userId: id, emailNormalized: "user@example.com", status: "active" }, { executor: duplicate }), AuthAlreadyExistsError));
  add("Unique token and identity violations map to typed duplicate errors", await expectsError(() => repository.createSession({ sessionId: `${id}_dupe_session`, userId: id, sessionTokenHash: hash, expiresAt }, { executor: duplicate }), AuthAlreadyExistsError) && await expectsError(() => repository.createExternalIdentity({ externalIdentityId: `${id}_dupe_identity`, userId: id, provider: "google", providerSubject: "subject" }, { executor: duplicate }), AuthAlreadyExistsError));
  const empty = new FakeExecutor();
  empty.empty = true;
  add("Missing update targets map to typed not-found errors", await expectsError(() => repository.setUserStatus(id, "active", { executor: empty }), AuthNotFoundError));

  await runPostgreSqlIntegrationAcceptance();
  await closeDatabasePool();

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9A auth foundation test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
