import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  executeDatabaseQuery,
  type DatabaseQueryExecutor,
} from "../../../infrastructure/database";
import { hashPassword, PASSWORD_HASH_PREFIX, verifyPassword } from "../../../infrastructure/security/password-hashing";
import {
  AuthAlreadyExistsError,
  AuthInvalidCredentialsError,
  AuthValidationError,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  type AuthRepositories,
  type PasswordCredential,
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

async function userIdsByEmailPrefix(prefix: string): Promise<readonly string[]> {
  const result = await executeDatabaseQuery<{ user_id: string }>({
    text: "SELECT user_id FROM auth_users WHERE email_normalized LIKE $1",
    values: [`${prefix}%@example.com`],
  });
  return result.rows.map((row) => row.user_id);
}

async function cleanup(prefix: string): Promise<void> {
  const userIds = await userIdsByEmailPrefix(prefix);
  if (!userIds.length) return;
  await executeDatabaseQuery({
    text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])",
    values: [userIds],
  });
}

async function countCredentials(userId: string): Promise<number> {
  const result = await executeDatabaseQuery<{ count: string }>({
    text: "SELECT COUNT(*)::text AS count FROM password_credentials WHERE user_id = $1",
    values: [userId],
  });
  return Number(result.rows[0]?.count ?? "0");
}

class FailingCredentialRepository extends PostgreSqlAuthRepository implements AuthRepositories {
  async upsertPasswordCredential(_input: Readonly<{ userId: string; passwordHash: string }>, _options?: RepositoryOptions): Promise<PasswordCredential> {
    throw new Error("forced credential failure");
  }
}

class TrackingExecutor implements DatabaseQueryExecutor {
  readonly queries: string[] = [];

  constructor(private readonly inner: DatabaseQueryExecutor) {}

  async execute<Row extends Record<string, unknown> = Record<string, unknown>>(query: Readonly<{ text: string; values?: readonly unknown[] }>): Promise<Readonly<{ rows: readonly Row[]; rowCount: number }>> {
    this.queries.push(query.text);
    return this.inner.execute<Row>(query);
  }
}

async function deletePasswordCredential(userId: string): Promise<void> {
  await executeDatabaseQuery({
    text: "DELETE FROM password_credentials WHERE user_id = $1",
    values: [userId],
  });
}

async function main(): Promise<void> {
  const prefix = `phase9b_${randomUUID().replace(/-/gu, "")}`;
  await cleanup(prefix);
  const repository = new PostgreSqlAuthRepository();
  const service = new PasswordAuthService(repository);

  try {
    const password = "Str0ng!Phase9B";
    const replacement = "N3w!Phase9BPass";
    const email = `${prefix}@Example.COM`;

    const directHash = await hashPassword(password);
    add("Password hashing uses scrypt password KDF", directHash.startsWith(PASSWORD_HASH_PREFIX) && !directHash.includes("sha256"));
    add("Password verification accepts only the matching password", await verifyPassword(password, directHash) && !(await verifyPassword("Wrong!Phase9B0", directHash)));
    add("Password verification fails safely for malformed stored hash", !(await verifyPassword(password, "scrypt:v1:16384:8:1:not base64:not base64")));
    add("Password verification fails safely for unsupported hash versions", !(await verifyPassword(password, directHash.replace("scrypt:v1", "scrypt:v2"))));

    add("Signup rejects weak passwords", await expectsError(() => service.signup({ email, password: "weak" }), AuthValidationError));
    add("Signup rejects excessively long passwords", await expectsError(() => service.signup({ email, password: `Aa1!${"x".repeat(253)}` }), AuthValidationError));
    add("Signup rejects invalid emails through Phase 9A normalization", await expectsError(() => service.signup({ email: "not-an-email", password }), AuthValidationError));

    const signup = await service.signup({ email, password });
    add("Signup creates an active normalized-email user", signup.user.emailNormalized === `${prefix}@example.com` && signup.user.status === "active");
    add("Signup result does not expose password hash", !("passwordHash" in signup) && !("passwordHash" in signup.user));

    const credential = await repository.findPasswordCredentialByUserId(signup.user.userId);
    add("Signup creates password credential atomically", credential !== null && await countCredentials(signup.user.userId) === 1);
    add("Plaintext password is never persisted as the credential", credential?.passwordHash !== password && credential?.passwordHash.includes(password) === false);
    add("Persisted password hash uses password-specific scrypt format", credential?.passwordHash.startsWith(PASSWORD_HASH_PREFIX) === true);

    add("Duplicate normalized email signup is rejected", await expectsError(() => service.signup({ email: `${prefix}@EXAMPLE.com`, password: "An0ther!Phase9B" }), AuthAlreadyExistsError));

    const login = await service.login({ email: ` ${prefix.toUpperCase()}@EXAMPLE.COM `, password });
    add("Login authenticates by normalized email and password", login.user.userId === signup.user.userId);
    add("Login result does not expose password hash", !("passwordHash" in login) && !("passwordHash" in login.user));
    add("Wrong email and wrong password use generic login failure", await expectsError(() => service.login({ email: `${prefix}_missing@example.com`, password }), AuthInvalidCredentialsError) && await expectsError(() => service.login({ email, password: "Wr0ng!Phase9B" }), AuthInvalidCredentialsError));

    await repository.setUserStatus(signup.user.userId, "disabled");
    add("Disabled users cannot authenticate and get generic failure", await expectsError(() => service.login({ email, password }), AuthInvalidCredentialsError));
    await repository.setUserStatus(signup.user.userId, "active");

    const missingCredentialEmail = `${prefix}_missing_credential@example.com`;
    const missingCredentialSignup = await service.signup({ email: missingCredentialEmail, password });
    await deletePasswordCredential(missingCredentialSignup.user.userId);
    add("Login with missing password credential uses generic failure", await expectsError(() => service.login({ email: missingCredentialEmail, password }), AuthInvalidCredentialsError));

    const beforeReplacement = (await repository.findPasswordCredentialByUserId(signup.user.userId))?.passwordHash;
    await service.replacePassword(signup.user.userId, replacement);
    const afterReplacement = await repository.findPasswordCredentialByUserId(signup.user.userId);
    add("Password replacement keeps one credential and changes the hash", await countCredentials(signup.user.userId) === 1 && beforeReplacement !== afterReplacement?.passwordHash);
    add("Old password fails and replacement password succeeds", await expectsError(() => service.login({ email, password }), AuthInvalidCredentialsError) && (await service.login({ email, password: replacement })).user.userId === signup.user.userId);

    const rollbackEmail = `${prefix}_rollback@example.com`;
    add("Transactional signup rolls back partial user records on credential failure", await expectsError(() => new PasswordAuthService(new FailingCredentialRepository()).signup({ email: rollbackEmail, password }), Error) && (await repository.findUserByEmail(rollbackEmail)) === null);

    const trackedEmail = `${prefix}_tracked@example.com`;
    await service.signup({ email: trackedEmail, password });
    const trackedUser = await repository.findUserByEmail(trackedEmail);
    const tracking = new TrackingExecutor({
      execute: (query) => executeDatabaseQuery(query),
    });
    if (trackedUser) {
      await repository.upsertPasswordCredential({ userId: trackedUser.userId, passwordHash: await hashPassword("Tr4cked!Phase9B") }, { executor: tracking });
    }
    add("Password credential replacement supports explicit executors", tracking.queries.length === 1 && tracking.queries[0]?.includes("password_credentials"));
  } finally {
    await cleanup(prefix);
    add("Phase 9B PostgreSQL rows are cleaned up", (await userIdsByEmailPrefix(prefix)).length === 0);
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 9B password auth test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
