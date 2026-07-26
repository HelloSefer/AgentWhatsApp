import { AccountRecoveryService, PasswordAuthService, PostgreSqlAuthRepository, SessionAuthService, type AuthEmailSender } from "../../modules/auth";
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
  return Object.freeze({
    authRepositories,
    passwordAuthService,
    accountRecoveryService: new AccountRecoveryService(authRepositories, emailSender),
    sessionAuthService: new SessionAuthService(authRepositories, passwordAuthService),
  });
}
