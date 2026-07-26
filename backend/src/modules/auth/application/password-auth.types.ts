import type { AuthUser } from "../domain/auth.types";

export type PasswordSignupInput = Readonly<{
  email: unknown;
  password: unknown;
}>;

export type PasswordLoginInput = Readonly<{
  email: unknown;
  password: unknown;
}>;

export type PasswordAuthUserResult = Readonly<{
  user: AuthUser;
}>;
