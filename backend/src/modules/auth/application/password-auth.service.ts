import { randomUUID } from "node:crypto";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../../../infrastructure/security/password-hashing";
import { withTransaction } from "../../../infrastructure/database";
import type { AuthRepositories } from "../contracts/auth.repository";
import {
  AuthAlreadyExistsError,
  AuthInvalidCredentialsError,
  AuthValidationError,
} from "../domain/auth.errors";
import { normalizeEmail } from "../domain/auth.validation";
import type { PasswordAuthUserResult, PasswordLoginInput, PasswordSignupInput } from "./password-auth.types";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

export function validatePassword(value: unknown): string {
  if (typeof value !== "string") throw new AuthValidationError();
  if (
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > MAX_PASSWORD_LENGTH ||
    !/[a-z]/u.test(value) ||
    !/[A-Z]/u.test(value) ||
    !/[0-9]/u.test(value) ||
    !/[^A-Za-z0-9]/u.test(value) ||
    /\s/u.test(value)
  ) {
    throw new AuthValidationError();
  }
  return value;
}

function validateLoginPassword(value: unknown): string {
  if (typeof value !== "string") throw new AuthInvalidCredentialsError();
  if (!value || value.length > MAX_PASSWORD_LENGTH) throw new AuthInvalidCredentialsError();
  return value;
}

export class PasswordAuthService {
  constructor(private readonly repositories: AuthRepositories) {}

  async signup(input: PasswordSignupInput): Promise<PasswordAuthUserResult> {
    const emailNormalized = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const passwordHash = await hashPassword(password);

    try {
      const user = await withTransaction(async (transaction) => {
        const created = await this.repositories.createUser({
          userId: randomUUID(),
          emailNormalized,
          status: "active",
        }, { executor: transaction });
        await this.repositories.upsertPasswordCredential({
          userId: created.userId,
          passwordHash,
        }, { executor: transaction });
        return created;
      });
      return { user };
    } catch (error) {
      if (error instanceof AuthAlreadyExistsError) throw new AuthAlreadyExistsError();
      throw error;
    }
  }

  async login(input: PasswordLoginInput): Promise<PasswordAuthUserResult> {
    const emailNormalized = normalizeEmail(input.email);
    const password = validateLoginPassword(input.password);
    const user = await this.repositories.findUserByEmail(emailNormalized);
    const credential = user ? await this.repositories.findPasswordCredentialByUserId(user.userId) : null;
    const shouldUseRealHash = user?.status === "active" && credential !== null;
    const passwordMatches = await verifyPassword(password, shouldUseRealHash ? credential.passwordHash : DUMMY_PASSWORD_HASH);

    if (!user || !credential || !passwordMatches || user.status !== "active") throw new AuthInvalidCredentialsError();
    return { user };
  }

  async replacePassword(userId: string, newPassword: unknown): Promise<void> {
    const password = validatePassword(newPassword);
    const user = await this.repositories.findUserById(userId);
    if (!user) throw new AuthInvalidCredentialsError();
    const passwordHash = await hashPassword(password);
    await this.repositories.upsertPasswordCredential({ userId: user.userId, passwordHash });
  }
}
