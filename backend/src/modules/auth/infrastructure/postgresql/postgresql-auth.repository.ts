import { DatabaseQueryError, executeDatabaseQuery, type DatabaseQueryExecutor } from "../../../../infrastructure/database";
import type {
  AuthRepositories,
  CreateUserInput,
  RepositoryOptions,
} from "../../contracts/auth.repository";
import {
  AuthAlreadyExistsError,
  AuthNotFoundError,
  AuthPersistenceError,
  AuthValidationError,
} from "../../domain/auth.errors";
import type {
  AuthSession,
  AuthStatus,
  AuthUser,
  EmailVerificationToken,
  ExternalIdentity,
  PasswordCredential,
  PasswordResetToken,
  SellerMembership,
} from "../../domain/auth.types";
import {
  normalizeEmail,
  validateAuthId,
  validateAuthRole,
  validateAuthStatus,
  validateExpiry,
  validateHash,
  validateOpaqueTokenHash,
  validateProvider,
  validateProviderSubject,
  validateSellerMembershipSellerId,
} from "../../domain/auth.validation";

type UserRow = Readonly<{ user_id: string; email_normalized: string; status: AuthStatus; email_verified_at: Date | string | null; created_at: Date | string; updated_at: Date | string }>;
type PasswordRow = Readonly<{ user_id: string; password_hash: string; created_at: Date | string; updated_at: Date | string }>;
type ExternalIdentityRow = Readonly<{ external_identity_id: string; user_id: string; provider: string; provider_subject: string; email_normalized: string | null; created_at: Date | string; updated_at: Date | string }>;
type SessionRow = Readonly<{ session_id: string; user_id: string; session_token_hash: string; created_at: Date | string; expires_at: Date | string; last_seen_at: Date | string | null; revoked_at: Date | string | null }>;
type EmailTokenRow = Readonly<{ token_id: string; user_id: string; token_hash: string; email_normalized: string; created_at: Date | string; expires_at: Date | string; used_at: Date | string | null; revoked_at: Date | string | null }>;
type ResetTokenRow = Readonly<{ token_id: string; user_id: string; token_hash: string; created_at: Date | string; expires_at: Date | string; used_at: Date | string | null; revoked_at: Date | string | null }>;
type MembershipRow = Readonly<{ seller_id: string; user_id: string; role: SellerMembership["role"]; status: AuthStatus; created_at: Date | string; updated_at: Date | string; disabled_at: Date | string | null }>;

const userColumns = "user_id, email_normalized, status, email_verified_at, created_at, updated_at";
const passwordColumns = "user_id, password_hash, created_at, updated_at";
const externalIdentityColumns = "external_identity_id, user_id, provider, provider_subject, email_normalized, created_at, updated_at";
const sessionColumns = "session_id, user_id, session_token_hash, created_at, expires_at, last_seen_at, revoked_at";
const emailTokenColumns = "token_id, user_id, token_hash, email_normalized, created_at, expires_at, used_at, revoked_at";
const resetTokenColumns = "token_id, user_id, token_hash, created_at, expires_at, used_at, revoked_at";
const membershipColumns = "seller_id, user_id, role, status, created_at, updated_at, disabled_at";

function executor(options?: RepositoryOptions): DatabaseQueryExecutor {
  return options?.executor ?? { execute: executeDatabaseQuery };
}

function date(value: Date | string | null): Date | undefined {
  if (value === null) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AuthPersistenceError();
  return parsed;
}

function requiredDate(value: Date | string): Date {
  const parsed = date(value);
  if (!parsed) throw new AuthPersistenceError();
  return parsed;
}

function code(error: unknown): string | undefined {
  return error instanceof DatabaseQueryError &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    typeof error.cause.code === "string"
    ? error.cause.code
    : undefined;
}

function mapUniqueOrPersistence(error: unknown): never {
  if (code(error) === "23505") throw new AuthAlreadyExistsError();
  if (error instanceof AuthPersistenceError || error instanceof AuthAlreadyExistsError || error instanceof AuthNotFoundError || error instanceof AuthValidationError) throw error;
  throw new AuthPersistenceError(error);
}

function mapUser(row: UserRow): AuthUser {
  return {
    userId: row.user_id,
    emailNormalized: row.email_normalized,
    status: row.status,
    emailVerifiedAt: date(row.email_verified_at),
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
  };
}

function mapPassword(row: PasswordRow): PasswordCredential {
  return { userId: row.user_id, passwordHash: row.password_hash, createdAt: requiredDate(row.created_at), updatedAt: requiredDate(row.updated_at) };
}

function mapExternalIdentity(row: ExternalIdentityRow): ExternalIdentity {
  return {
    externalIdentityId: row.external_identity_id,
    userId: row.user_id,
    provider: row.provider,
    providerSubject: row.provider_subject,
    emailNormalized: row.email_normalized ?? undefined,
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
  };
}

function mapSession(row: SessionRow): AuthSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    sessionTokenHash: row.session_token_hash,
    createdAt: requiredDate(row.created_at),
    expiresAt: requiredDate(row.expires_at),
    lastSeenAt: date(row.last_seen_at),
    revokedAt: date(row.revoked_at),
  };
}

function mapEmailToken(row: EmailTokenRow): EmailVerificationToken {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    emailNormalized: row.email_normalized,
    createdAt: requiredDate(row.created_at),
    expiresAt: requiredDate(row.expires_at),
    usedAt: date(row.used_at),
    revokedAt: date(row.revoked_at),
  };
}

function mapResetToken(row: ResetTokenRow): PasswordResetToken {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: requiredDate(row.created_at),
    expiresAt: requiredDate(row.expires_at),
    usedAt: date(row.used_at),
    revokedAt: date(row.revoked_at),
  };
}

function mapMembership(row: MembershipRow): SellerMembership {
  return {
    sellerId: row.seller_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
    disabledAt: date(row.disabled_at),
  };
}

export class PostgreSqlAuthRepository implements AuthRepositories {
  async createUser(input: CreateUserInput, options?: RepositoryOptions): Promise<AuthUser> {
    const userId = validateAuthId(input.userId);
    const email = normalizeEmail(input.emailNormalized);
    const status = validateAuthStatus(input.status);
    try {
      const result = await executor(options).execute<UserRow>({
        text: `INSERT INTO auth_users (user_id, email_normalized, status) VALUES ($1, $2, $3) RETURNING ${userColumns}`,
        values: [userId, email, status],
      });
      const row = result.rows[0];
      if (!row) throw new AuthPersistenceError();
      return mapUser(row);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findUserById(userId: string, options?: RepositoryOptions): Promise<AuthUser | null> {
    try {
      const result = await executor(options).execute<UserRow>({ text: `SELECT ${userColumns} FROM auth_users WHERE user_id = $1 LIMIT 1`, values: [validateAuthId(userId)] });
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findUserByEmail(emailNormalized: string, options?: RepositoryOptions): Promise<AuthUser | null> {
    try {
      const result = await executor(options).execute<UserRow>({ text: `SELECT ${userColumns} FROM auth_users WHERE email_normalized = $1 LIMIT 1`, values: [normalizeEmail(emailNormalized)] });
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async setUserStatus(userId: string, status: AuthStatus, options?: RepositoryOptions): Promise<AuthUser> {
    try {
      const result = await executor(options).execute<UserRow>({ text: `UPDATE auth_users SET status = $2, updated_at = NOW() WHERE user_id = $1 RETURNING ${userColumns}`, values: [validateAuthId(userId), validateAuthStatus(status)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapUser(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async markEmailVerified(userId: string, verifiedAt: Date, options?: RepositoryOptions): Promise<AuthUser> {
    try {
      const result = await executor(options).execute<UserRow>({ text: `UPDATE auth_users SET email_verified_at = $2, updated_at = NOW() WHERE user_id = $1 RETURNING ${userColumns}`, values: [validateAuthId(userId), validateExpiry(verifiedAt)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapUser(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async upsertPasswordCredential(input: Readonly<{ userId: string; passwordHash: string }>, options?: RepositoryOptions): Promise<PasswordCredential> {
    try {
      const result = await executor(options).execute<PasswordRow>({
        text: `INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW() RETURNING ${passwordColumns}`,
        values: [validateAuthId(input.userId), validateHash(input.passwordHash)],
      });
      if (!result.rows[0]) throw new AuthPersistenceError();
      return mapPassword(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findPasswordCredentialByUserId(userId: string, options?: RepositoryOptions): Promise<PasswordCredential | null> {
    try {
      const result = await executor(options).execute<PasswordRow>({ text: `SELECT ${passwordColumns} FROM password_credentials WHERE user_id = $1 LIMIT 1`, values: [validateAuthId(userId)] });
      return result.rows[0] ? mapPassword(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async createExternalIdentity(input: Readonly<{ externalIdentityId: string; userId: string; provider: string; providerSubject: string; emailNormalized?: string }>, options?: RepositoryOptions): Promise<ExternalIdentity> {
    try {
      const result = await executor(options).execute<ExternalIdentityRow>({
        text: `INSERT INTO external_identities (external_identity_id, user_id, provider, provider_subject, email_normalized) VALUES ($1, $2, $3, $4, $5) RETURNING ${externalIdentityColumns}`,
        values: [validateAuthId(input.externalIdentityId), validateAuthId(input.userId), validateProvider(input.provider), validateProviderSubject(input.providerSubject), input.emailNormalized ? normalizeEmail(input.emailNormalized) : null],
      });
      if (!result.rows[0]) throw new AuthPersistenceError();
      return mapExternalIdentity(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findExternalIdentity(provider: string, providerSubject: string, options?: RepositoryOptions): Promise<ExternalIdentity | null> {
    try {
      const result = await executor(options).execute<ExternalIdentityRow>({ text: `SELECT ${externalIdentityColumns} FROM external_identities WHERE provider = $1 AND provider_subject = $2 LIMIT 1`, values: [validateProvider(provider), validateProviderSubject(providerSubject)] });
      return result.rows[0] ? mapExternalIdentity(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async listExternalIdentitiesForUser(userId: string, options?: RepositoryOptions): Promise<readonly ExternalIdentity[]> {
    try {
      const result = await executor(options).execute<ExternalIdentityRow>({ text: `SELECT ${externalIdentityColumns} FROM external_identities WHERE user_id = $1 ORDER BY provider ASC, provider_subject ASC`, values: [validateAuthId(userId)] });
      return result.rows.map(mapExternalIdentity);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async createSession(input: Readonly<{ sessionId: string; userId: string; sessionTokenHash: string; expiresAt: Date }>, options?: RepositoryOptions): Promise<AuthSession> {
    try {
      const result = await executor(options).execute<SessionRow>({
        text: `INSERT INTO auth_sessions (session_id, user_id, session_token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING ${sessionColumns}`,
        values: [validateAuthId(input.sessionId), validateAuthId(input.userId), validateOpaqueTokenHash(input.sessionTokenHash), validateExpiry(input.expiresAt)],
      });
      if (!result.rows[0]) throw new AuthPersistenceError();
      return mapSession(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findSessionByTokenHash(sessionTokenHash: string, options?: RepositoryOptions): Promise<AuthSession | null> {
    try {
      const result = await executor(options).execute<SessionRow>({ text: `SELECT ${sessionColumns} FROM auth_sessions WHERE session_token_hash = $1 LIMIT 1`, values: [validateOpaqueTokenHash(sessionTokenHash)] });
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async revokeSession(sessionId: string, revokedAt: Date, options?: RepositoryOptions): Promise<AuthSession> {
    try {
      const result = await executor(options).execute<SessionRow>({ text: `UPDATE auth_sessions SET revoked_at = $2 WHERE session_id = $1 RETURNING ${sessionColumns}`, values: [validateAuthId(sessionId), validateExpiry(revokedAt)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapSession(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async createEmailVerificationToken(input: Readonly<{ tokenId: string; userId: string; tokenHash: string; emailNormalized: string; expiresAt: Date }>, options?: RepositoryOptions): Promise<EmailVerificationToken> {
    try {
      const result = await executor(options).execute<EmailTokenRow>({
        text: `INSERT INTO email_verification_tokens (token_id, user_id, token_hash, email_normalized, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING ${emailTokenColumns}`,
        values: [validateAuthId(input.tokenId), validateAuthId(input.userId), validateOpaqueTokenHash(input.tokenHash), normalizeEmail(input.emailNormalized), validateExpiry(input.expiresAt)],
      });
      if (!result.rows[0]) throw new AuthPersistenceError();
      return mapEmailToken(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findEmailVerificationTokenByHash(tokenHash: string, options?: RepositoryOptions): Promise<EmailVerificationToken | null> {
    try {
      const result = await executor(options).execute<EmailTokenRow>({ text: `SELECT ${emailTokenColumns} FROM email_verification_tokens WHERE token_hash = $1 LIMIT 1`, values: [validateOpaqueTokenHash(tokenHash)] });
      return result.rows[0] ? mapEmailToken(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async markEmailVerificationTokenUsed(tokenId: string, usedAt: Date, options?: RepositoryOptions): Promise<EmailVerificationToken> {
    try {
      const result = await executor(options).execute<EmailTokenRow>({ text: `UPDATE email_verification_tokens SET used_at = $2 WHERE token_id = $1 RETURNING ${emailTokenColumns}`, values: [validateAuthId(tokenId), validateExpiry(usedAt)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapEmailToken(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async revokeEmailVerificationToken(tokenId: string, revokedAt: Date, options?: RepositoryOptions): Promise<EmailVerificationToken> {
    try {
      const result = await executor(options).execute<EmailTokenRow>({ text: `UPDATE email_verification_tokens SET revoked_at = $2 WHERE token_id = $1 RETURNING ${emailTokenColumns}`, values: [validateAuthId(tokenId), validateExpiry(revokedAt)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapEmailToken(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async createPasswordResetToken(input: Readonly<{ tokenId: string; userId: string; tokenHash: string; expiresAt: Date }>, options?: RepositoryOptions): Promise<PasswordResetToken> {
    try {
      const result = await executor(options).execute<ResetTokenRow>({
        text: `INSERT INTO password_reset_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING ${resetTokenColumns}`,
        values: [validateAuthId(input.tokenId), validateAuthId(input.userId), validateOpaqueTokenHash(input.tokenHash), validateExpiry(input.expiresAt)],
      });
      if (!result.rows[0]) throw new AuthPersistenceError();
      return mapResetToken(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findPasswordResetTokenByHash(tokenHash: string, options?: RepositoryOptions): Promise<PasswordResetToken | null> {
    try {
      const result = await executor(options).execute<ResetTokenRow>({ text: `SELECT ${resetTokenColumns} FROM password_reset_tokens WHERE token_hash = $1 LIMIT 1`, values: [validateOpaqueTokenHash(tokenHash)] });
      return result.rows[0] ? mapResetToken(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async markPasswordResetTokenUsed(tokenId: string, usedAt: Date, options?: RepositoryOptions): Promise<PasswordResetToken> {
    try {
      const result = await executor(options).execute<ResetTokenRow>({ text: `UPDATE password_reset_tokens SET used_at = $2 WHERE token_id = $1 RETURNING ${resetTokenColumns}`, values: [validateAuthId(tokenId), validateExpiry(usedAt)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapResetToken(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async revokePasswordResetToken(tokenId: string, revokedAt: Date, options?: RepositoryOptions): Promise<PasswordResetToken> {
    try {
      const result = await executor(options).execute<ResetTokenRow>({ text: `UPDATE password_reset_tokens SET revoked_at = $2 WHERE token_id = $1 RETURNING ${resetTokenColumns}`, values: [validateAuthId(tokenId), validateExpiry(revokedAt)] });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapResetToken(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async createSellerMembership(input: Readonly<{ sellerId: string; userId: string; role: SellerMembership["role"]; status: AuthStatus }>, options?: RepositoryOptions): Promise<SellerMembership> {
    try {
      const result = await executor(options).execute<MembershipRow>({
        text: `INSERT INTO seller_memberships (seller_id, user_id, role, status, disabled_at) VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'disabled' THEN NOW() ELSE NULL END) RETURNING ${membershipColumns}`,
        values: [validateSellerMembershipSellerId(input.sellerId), validateAuthId(input.userId), validateAuthRole(input.role), validateAuthStatus(input.status)],
      });
      if (!result.rows[0]) throw new AuthPersistenceError();
      return mapMembership(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async findSellerMembership(sellerId: string, userId: string, options?: RepositoryOptions): Promise<SellerMembership | null> {
    try {
      const result = await executor(options).execute<MembershipRow>({ text: `SELECT ${membershipColumns} FROM seller_memberships WHERE seller_id = $1 AND user_id = $2 LIMIT 1`, values: [validateSellerMembershipSellerId(sellerId), validateAuthId(userId)] });
      return result.rows[0] ? mapMembership(result.rows[0]) : null;
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async listSellerMembershipsForUser(userId: string, options?: RepositoryOptions): Promise<readonly SellerMembership[]> {
    try {
      const result = await executor(options).execute<MembershipRow>({ text: `SELECT ${membershipColumns} FROM seller_memberships WHERE user_id = $1 ORDER BY seller_id ASC`, values: [validateAuthId(userId)] });
      return result.rows.map(mapMembership);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async setSellerMembershipStatus(sellerId: string, userId: string, status: AuthStatus, disabledAt: Date | undefined, options?: RepositoryOptions): Promise<SellerMembership> {
    const nextStatus = validateAuthStatus(status);
    try {
      const result = await executor(options).execute<MembershipRow>({
        text: `UPDATE seller_memberships SET status = $3, disabled_at = CASE WHEN $3 = 'disabled' THEN $4 ELSE NULL END, updated_at = NOW() WHERE seller_id = $1 AND user_id = $2 RETURNING ${membershipColumns}`,
        values: [validateSellerMembershipSellerId(sellerId), validateAuthId(userId), nextStatus, nextStatus === "disabled" ? validateExpiry(disabledAt ?? new Date()) : null],
      });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapMembership(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }

  async setSellerMembershipRole(sellerId: string, userId: string, role: SellerMembership["role"], options?: RepositoryOptions): Promise<SellerMembership> {
    try {
      const result = await executor(options).execute<MembershipRow>({
        text: `UPDATE seller_memberships SET role = $3, updated_at = NOW() WHERE seller_id = $1 AND user_id = $2 RETURNING ${membershipColumns}`,
        values: [validateSellerMembershipSellerId(sellerId), validateAuthId(userId), validateAuthRole(role)],
      });
      if (!result.rows[0]) throw new AuthNotFoundError();
      return mapMembership(result.rows[0]);
    } catch (error) {
      mapUniqueOrPersistence(error);
    }
  }
}

export const postgreSqlAuthRepository = new PostgreSqlAuthRepository();
