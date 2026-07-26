import type { AccountRecoveryService, AuthorizationService, AuthRepositories, GoogleAuthService, PasswordAuthService, SessionAuthService } from "../../modules/auth";

export type AuthComposition = Readonly<{
  authRepositories: AuthRepositories;
  passwordAuthService: PasswordAuthService;
  accountRecoveryService: AccountRecoveryService;
  sessionAuthService: SessionAuthService;
  googleAuthService: GoogleAuthService;
  authorizationService: AuthorizationService;
}>;
