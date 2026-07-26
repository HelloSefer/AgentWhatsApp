import { env } from "../../config/env";
import { AccountRecoveryService, GoogleAuthService, GoogleOAuthIdentityProvider, PasswordAuthService, PostgreSqlAuthRepository, SessionAuthService, type AuthEmailSender } from "../../modules/auth";
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
  });
}
