import type { AuthRepositories } from "../../modules/auth";

export type AuthComposition = Readonly<{
  authRepositories: AuthRepositories;
}>;
