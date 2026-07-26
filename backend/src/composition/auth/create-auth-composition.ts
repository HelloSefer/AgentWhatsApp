import { env } from "../../config/env";
import { AccountRecoveryService, AuthRateLimiter, AuthorizationService, GoogleAuthService, GoogleOAuthIdentityProvider, InMemoryAuthRateLimitStore, PasswordAuthService, PostgreSqlAuthRepository, SessionAuthService, ValkeyAuthRateLimitStore, type AuthEmailSender } from "../../modules/auth";
import type { AuthComposition } from "./auth-composition.types";

const noopAuthEmailSender: AuthEmailSender = Object.freeze({
  sendEmailVerification: async () => undefined,
  sendPasswordReset: async () => undefined,
});

/**
 * Builds auth persistence dependencies without opening database connections.
 * Auth HTTP, OAuth, cookies, and authorization middleware are intentionally absent.
 */
export function createAuthComposition(emailSender: AuthEmailSender = noopAuthEmailSender): AuthComposition {
  const authRepositories = new PostgreSqlAuthRepository();
  const passwordAuthService = new PasswordAuthService(authRepositories);
  const sessionAuthService = new SessionAuthService(authRepositories, passwordAuthService);
  const googleProvider = new GoogleOAuthIdentityProvider(env.googleClientId, env.googleClientSecret);
  const authRateLimiter = new AuthRateLimiter(
    env.nodeEnv === "production" ? new ValkeyAuthRateLimitStore() : new InMemoryAuthRateLimitStore(),
  );
  return Object.freeze({
    authRepositories,
    passwordAuthService,
    accountRecoveryService: new AccountRecoveryService(authRepositories, emailSender),
    sessionAuthService,
    googleAuthService: new GoogleAuthService(authRepositories, sessionAuthService, googleProvider, {
      enabled: Boolean(env.googleClientId && env.googleClientSecret && env.googleCallbackUrl && env.frontendBaseUrl),
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      callbackUrl: env.googleCallbackUrl,
      frontendBaseUrl: env.frontendBaseUrl,
      postLoginPath: env.googleAuthPostLoginPath,
    }),
    authorizationService: new AuthorizationService(authRepositories),
    authRateLimiter,
  });
}
