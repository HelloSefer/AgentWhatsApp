import type { AccountRecoveryService, AuthRepositories, PasswordAuthService } from "../../modules/auth";

export type AuthComposition = Readonly<{
  authRepositories: AuthRepositories;
  passwordAuthService: PasswordAuthService;
  accountRecoveryService: AccountRecoveryService;
}>;
