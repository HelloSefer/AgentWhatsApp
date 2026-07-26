import { PostgreSqlAuthRepository } from "../../modules/auth";
import type { AuthComposition } from "./auth-composition.types";

/**
 * Builds auth persistence dependencies without opening database connections.
 * Auth HTTP, OAuth, cookies, and authorization middleware are intentionally absent.
 */
export function createAuthComposition(): AuthComposition {
  return Object.freeze({
    authRepositories: new PostgreSqlAuthRepository(),
  });
}
