import { env } from "../../config/env";
import { AccountRecoveryService, AuthRateLimiter, AuthorizationService, GoogleAuthService, GoogleOAuthIdentityProvider, InMemoryAuthRateLimitStore, PasswordAuthService, PostgreSqlAuthRepository, SessionAuthService, SmtpAuthEmailSender, ValkeyAuthRateLimitStore, type AuthEmailSender } from "../../modules/auth";
import type { AuthComposition } from "./auth-composition.types";

const noopAuthEmailSender: AuthEmailSender = Object.freeze({
  sendEmailVerification: async () => undefined,
  sendPasswordReset: async () => undefined,
});

function createConfiguredAuthEmailSender(): AuthEmailSender {
  if (
    !env.authEmailSmtpHost &&
    !env.authEmailSmtpPort &&
    !env.authEmailSmtpUser &&
    !env.authEmailSmtpPassword &&
    !env.authEmailFromName &&
    !env.authEmailFromAddress
  ) {
    return noopAuthEmailSender;
  }

  return new SmtpAuthEmailSender({
    host: env.authEmailSmtpHost,
    port: env.authEmailSmtpPort,
    secure: env.authEmailSmtpSecure,
    user: env.authEmailSmtpUser,
    password: env.authEmailSmtpPassword,
    fromName: env.authEmailFromName,
    fromAddress: env.authEmailFromAddress,
    frontendBaseUrl: env.frontendBaseUrl,
  });
}

/**
 * Builds auth persistence dependencies without opening database or SMTP connections.
 * Auth HTTP, OAuth, cookies, and authorization middleware are intentionally absent.
 */
export function createAuthComposition(emailSender: AuthEmailSender = createConfiguredAuthEmailSender()): AuthComposition {
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
