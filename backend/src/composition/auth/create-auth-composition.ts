import { PasswordAuthService, PostgreSqlAuthRepository } from "../../modules/auth";
import type { AuthComposition } from "./auth-composition.types";

/**
 * Builds auth persistence dependencies without opening database connections.
 * Auth HTTP, OAuth, cookies, and authorization middleware are intentionally absent.
 */
export function createAuthComposition(): AuthComposition {
  const authRepositories = new PostgreSqlAuthRepository();
  return Object.freeze({
    authRepositories,
    passwordAuthService: new PasswordAuthService(authRepositories),
  });
}
