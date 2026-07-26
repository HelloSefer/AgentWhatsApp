export type {
  AuthRepositories,
  AuthSessionRepository,
  AuthUserRepository,
  EmailVerificationTokenRepository,
  ExternalIdentityRepository,
  PasswordCredentialRepository,
  PasswordResetTokenRepository,
  RepositoryOptions,
  SellerMembershipRepository,
} from "./contracts/auth.repository";
export type {
  AuthRole,
  AuthSession,
  AuthStatus,
  AuthUser,
  EmailVerificationToken,
  ExternalIdentity,
  PasswordCredential,
  PasswordResetToken,
  SellerMembership,
} from "./domain/auth.types";
export { AUTH_ROLES, AUTH_STATUSES } from "./domain/auth.types";
export {
  normalizeEmail,
  validateAuthId,
  validateAuthRole,
  validateAuthStatus,
  validateHash,
  validateOpaqueTokenHash,
  validateProvider,
  validateProviderSubject,
  validateSellerMembershipSellerId,
} from "./domain/auth.validation";
export { AuthAlreadyExistsError, AuthInvalidCredentialsError, AuthNotFoundError, AuthPersistenceError, AuthValidationError } from "./domain/auth.errors";
export { PostgreSqlAuthRepository, postgreSqlAuthRepository } from "./infrastructure/postgresql/postgresql-auth.repository";
export { PasswordAuthService } from "./application/password-auth.service";
export type { PasswordAuthUserResult, PasswordLoginInput, PasswordSignupInput } from "./application/password-auth.types";
