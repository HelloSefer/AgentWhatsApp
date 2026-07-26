import { AccountRecoveryService, PasswordAuthService, PostgreSqlAuthRepository, type AuthEmailSender } from "../../modules/auth";
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
  return Object.freeze({
    authRepositories,
    passwordAuthService: new PasswordAuthService(authRepositories),
    accountRecoveryService: new AccountRecoveryService(authRepositories, emailSender),
  });
}
