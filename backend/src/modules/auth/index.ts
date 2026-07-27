export { AccountRecoveryService } from "./application/account-recovery.service";
export type {
  AccountRecoveryConfirmResult,
  AccountRecoveryRequestResult,
  ConfirmEmailVerificationInput,
  ConfirmPasswordResetInput,
  RequestEmailVerificationInput,
  RequestPasswordResetInput,
} from "./application/account-recovery.types";
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
export type { AuthEmailSender, AuthEmailVerificationMessage, AuthPasswordResetMessage } from "./contracts/auth-email.sender";
export type { GoogleIdentityProvider, VerifiedGoogleIdentity } from "./contracts/google-identity.provider";
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
export { AuthAlreadyExistsError, AuthEmailDeliveryError, AuthInvalidCredentialsError, AuthInvalidTokenError, AuthNotFoundError, AuthPersistenceError, AuthValidationError } from "./domain/auth.errors";
export { PostgreSqlAuthRepository, postgreSqlAuthRepository } from "./infrastructure/postgresql/postgresql-auth.repository";
export { PasswordAuthService } from "./application/password-auth.service";
export { AuthRateLimiter, AuthRateLimitExceededError, InMemoryAuthRateLimitStore } from "./application/auth-rate-limiter";
export type { AuthRateLimitAction, AuthRateLimitStore } from "./application/auth-rate-limiter";
export { AuthorizationService } from "./application/authorization.service";
export type { AuthorizationInput, AuthorizedTenantContext } from "./application/authorization.types";
export { AuthorizationError, AuthorizationForbiddenError, AuthorizationInsufficientPermissionError, AuthorizationInvalidSellerTargetError, AuthorizationNoActiveMembershipError, AuthorizationTenantSelectionRequiredError, AuthorizationUnauthenticatedError } from "./application/authorization.errors";
export { GoogleAuthService, GoogleAuthUnavailableError, createPkceChallenge } from "./application/google-auth.service";
export type { GoogleAuthCallbackInput, GoogleAuthCallbackResult, GoogleAuthConfiguration, GoogleAuthStartResult } from "./application/google-auth.types";
export { GoogleOAuthIdentityProvider } from "./infrastructure/google/google-oauth-identity.provider";
export { SmtpAuthEmailConfigurationError, SmtpAuthEmailSender } from "./infrastructure/smtp/smtp-auth-email.sender";
export type { SmtpAuthEmailConfiguration } from "./infrastructure/smtp/smtp-auth-email.sender";
export { ValkeyAuthRateLimitStore } from "./infrastructure/valkey/valkey-auth-rate-limit.store";
export type { PasswordAuthUserResult, PasswordLoginInput, PasswordSignupInput } from "./application/password-auth.types";
export { AUTH_SESSION_TTL_MS, SessionAuthService } from "./application/session-auth.service";
export type { AuthenticatedMembership, AuthenticatedPrincipal, CurrentUserResult, SanitizedAuthUser, SessionIssueResult } from "./application/session-auth.types";
export { AUTH_PERMISSIONS, ROLE_PERMISSIONS, isAuthPermission, roleHasPermission } from "./domain/authorization.policy";
export type { AuthPermission } from "./domain/authorization.policy";
export { resolveRequestedSellerTarget } from "./http/seller-target.resolver";
export { SELLER_ROUTE_PERMISSIONS } from "./http/seller-route-permissions";
