import type { AuthRepositories, PasswordAuthService } from "../../modules/auth";

export type AuthComposition = Readonly<{
  authRepositories: AuthRepositories;
  passwordAuthService: PasswordAuthService;
}>;
