import type { DatabaseQueryExecutor } from "../../../infrastructure/database";
import type {
  AuthRole,
  AuthSession,
  AuthStatus,
  AuthUser,
  EmailVerificationToken,
  ExternalIdentity,
  PasswordCredential,
  PasswordResetToken,
  SellerMembership,
} from "../domain/auth.types";

export type RepositoryOptions = Readonly<{
  executor?: DatabaseQueryExecutor;
}>;

export type CreateUserInput = Readonly<{
  userId: string;
  emailNormalized: string;
  status: AuthStatus;
}>;

export interface AuthUserRepository {
  createUser(input: CreateUserInput, options?: RepositoryOptions): Promise<AuthUser>;
  findUserById(userId: string, options?: RepositoryOptions): Promise<AuthUser | null>;
  findUserByEmail(emailNormalized: string, options?: RepositoryOptions): Promise<AuthUser | null>;
  setUserStatus(userId: string, status: AuthStatus, options?: RepositoryOptions): Promise<AuthUser>;
  markEmailVerified(userId: string, verifiedAt: Date, options?: RepositoryOptions): Promise<AuthUser>;
}

export interface PasswordCredentialRepository {
  upsertPasswordCredential(input: Readonly<{ userId: string; passwordHash: string }>, options?: RepositoryOptions): Promise<PasswordCredential>;
  findPasswordCredentialByUserId(userId: string, options?: RepositoryOptions): Promise<PasswordCredential | null>;
}

export interface ExternalIdentityRepository {
  createExternalIdentity(input: Readonly<{ externalIdentityId: string; userId: string; provider: string; providerSubject: string; emailNormalized?: string }>, options?: RepositoryOptions): Promise<ExternalIdentity>;
  findExternalIdentity(provider: string, providerSubject: string, options?: RepositoryOptions): Promise<ExternalIdentity | null>;
  listExternalIdentitiesForUser(userId: string, options?: RepositoryOptions): Promise<readonly ExternalIdentity[]>;
}

export interface AuthSessionRepository {
  createSession(input: Readonly<{ sessionId: string; userId: string; sessionTokenHash: string; expiresAt: Date }>, options?: RepositoryOptions): Promise<AuthSession>;
  findSessionByTokenHash(sessionTokenHash: string, options?: RepositoryOptions): Promise<AuthSession | null>;
  revokeSession(sessionId: string, revokedAt: Date, options?: RepositoryOptions): Promise<AuthSession>;
}

export interface EmailVerificationTokenRepository {
  createEmailVerificationToken(input: Readonly<{ tokenId: string; userId: string; tokenHash: string; emailNormalized: string; expiresAt: Date }>, options?: RepositoryOptions): Promise<EmailVerificationToken>;
  findEmailVerificationTokenByHash(tokenHash: string, options?: RepositoryOptions): Promise<EmailVerificationToken | null>;
  markEmailVerificationTokenUsed(tokenId: string, usedAt: Date, options?: RepositoryOptions): Promise<EmailVerificationToken>;
  revokeEmailVerificationToken(tokenId: string, revokedAt: Date, options?: RepositoryOptions): Promise<EmailVerificationToken>;
}

export interface PasswordResetTokenRepository {
  createPasswordResetToken(input: Readonly<{ tokenId: string; userId: string; tokenHash: string; expiresAt: Date }>, options?: RepositoryOptions): Promise<PasswordResetToken>;
  findPasswordResetTokenByHash(tokenHash: string, options?: RepositoryOptions): Promise<PasswordResetToken | null>;
  markPasswordResetTokenUsed(tokenId: string, usedAt: Date, options?: RepositoryOptions): Promise<PasswordResetToken>;
  revokePasswordResetToken(tokenId: string, revokedAt: Date, options?: RepositoryOptions): Promise<PasswordResetToken>;
}

export interface SellerMembershipRepository {
  createSellerMembership(input: Readonly<{ sellerId: string; userId: string; role: AuthRole; status: AuthStatus }>, options?: RepositoryOptions): Promise<SellerMembership>;
  findSellerMembership(sellerId: string, userId: string, options?: RepositoryOptions): Promise<SellerMembership | null>;
  listSellerMembershipsForUser(userId: string, options?: RepositoryOptions): Promise<readonly SellerMembership[]>;
  setSellerMembershipStatus(sellerId: string, userId: string, status: AuthStatus, disabledAt: Date | undefined, options?: RepositoryOptions): Promise<SellerMembership>;
  setSellerMembershipRole(sellerId: string, userId: string, role: AuthRole, options?: RepositoryOptions): Promise<SellerMembership>;
}

export type AuthRepositories = AuthUserRepository &
  PasswordCredentialRepository &
  ExternalIdentityRepository &
  AuthSessionRepository &
  EmailVerificationTokenRepository &
  PasswordResetTokenRepository &
  SellerMembershipRepository;
