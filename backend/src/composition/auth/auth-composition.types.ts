import type { AccountRecoveryService, AuthRepositories, PasswordAuthService, SessionAuthService } from "../../modules/auth";

export type AuthComposition = Readonly<{
  authRepositories: AuthRepositories;
  passwordAuthService: PasswordAuthService;
  accountRecoveryService: AccountRecoveryService;
  sessionAuthService: SessionAuthService;
}>;
