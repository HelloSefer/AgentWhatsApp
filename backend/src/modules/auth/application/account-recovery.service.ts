import { randomUUID } from "node:crypto";
import { withTransaction } from "../../../infrastructure/database";
import { generateOpaqueToken, hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import { hashPassword } from "../../../infrastructure/security/password-hashing";
import type { AuthEmailSender } from "../contracts/auth-email.sender";
import type { AuthRepositories } from "../contracts/auth.repository";
import { AuthEmailDeliveryError, AuthInvalidTokenError, AuthNotFoundError } from "../domain/auth.errors";
import { normalizeEmail } from "../domain/auth.validation";
import { validatePassword } from "./password-auth.service";
import type {
  AccountRecoveryConfirmResult,
  AccountRecoveryRequestResult,
  ConfirmEmailVerificationInput,
  ConfirmPasswordResetInput,
  RequestEmailVerificationInput,
  RequestPasswordResetInput,
} from "./account-recovery.types";

const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function expiresAt(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

function isUsableToken(token: Readonly<{ expiresAt: Date; usedAt?: Date; revokedAt?: Date }>): boolean {
  return token.usedAt === undefined && token.revokedAt === undefined && token.expiresAt.getTime() > Date.now();
}

export class AccountRecoveryService {
  constructor(
    private readonly repositories: AuthRepositories,
    private readonly emailSender: AuthEmailSender,
  ) {}

  async requestEmailVerification(input: RequestEmailVerificationInput): Promise<AccountRecoveryRequestResult> {
    const emailNormalized = normalizeEmail(input.email);
    const user = await this.repositories.findUserByEmail(emailNormalized);
    if (!user || user.status !== "active") return { accepted: true };

    const rawToken = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawToken);
    if (!tokenHash) throw new AuthInvalidTokenError();
    const tokenExpiresAt = expiresAt(EMAIL_VERIFICATION_TOKEN_TTL_MS);

    await withTransaction(async (transaction) => {
      await this.repositories.revokeActiveEmailVerificationTokensForUser(user.userId, new Date(), { executor: transaction });
      await this.repositories.createEmailVerificationToken({
        tokenId: randomUUID(),
        userId: user.userId,
        tokenHash,
        emailNormalized,
        expiresAt: tokenExpiresAt,
      }, { executor: transaction });
    });

    try {
      await this.emailSender.sendEmailVerification({ emailNormalized, verificationToken: rawToken, expiresAt: tokenExpiresAt });
    } catch (error) {
      throw new AuthEmailDeliveryError(error);
    }
    return { accepted: true };
  }

  async confirmEmailVerification(input: ConfirmEmailVerificationInput): Promise<AccountRecoveryConfirmResult> {
    const tokenHash = hashOpaqueToken(input.token);
    if (!tokenHash) throw new AuthInvalidTokenError();

    await withTransaction(async (transaction) => {
      const token = await this.repositories.findEmailVerificationTokenByHash(tokenHash, { executor: transaction });
      if (!token || !isUsableToken(token)) throw new AuthInvalidTokenError();
      const user = await this.repositories.findUserById(token.userId, { executor: transaction });
      if (!user || user.status !== "active") throw new AuthInvalidTokenError();
      await this.repositories.markEmailVerified(user.userId, new Date(), { executor: transaction });
      try {
        await this.repositories.markEmailVerificationTokenUsed(token.tokenId, new Date(), { executor: transaction });
      } catch (error) {
        if (error instanceof AuthNotFoundError) throw new AuthInvalidTokenError();
        throw error;
      }
    });

    return { completed: true };
  }

  async requestPasswordReset(input: RequestPasswordResetInput): Promise<AccountRecoveryRequestResult> {
    const emailNormalized = normalizeEmail(input.email);
    const user = await this.repositories.findUserByEmail(emailNormalized);
    if (!user || user.status !== "active") return { accepted: true };

    const rawToken = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawToken);
    if (!tokenHash) throw new AuthInvalidTokenError();
    const tokenExpiresAt = expiresAt(PASSWORD_RESET_TOKEN_TTL_MS);

    await withTransaction(async (transaction) => {
      await this.repositories.revokeActivePasswordResetTokensForUser(user.userId, new Date(), { executor: transaction });
      await this.repositories.createPasswordResetToken({
        tokenId: randomUUID(),
        userId: user.userId,
        tokenHash,
        expiresAt: tokenExpiresAt,
      }, { executor: transaction });
    });

    try {
      await this.emailSender.sendPasswordReset({ emailNormalized, resetToken: rawToken, expiresAt: tokenExpiresAt });
    } catch (error) {
      throw new AuthEmailDeliveryError(error);
    }
    return { accepted: true };
  }

  async confirmPasswordReset(input: ConfirmPasswordResetInput): Promise<AccountRecoveryConfirmResult> {
    const tokenHash = hashOpaqueToken(input.token);
    if (!tokenHash) throw new AuthInvalidTokenError();
    const password = validatePassword(input.newPassword);
    const passwordHash = await hashPassword(password);

    await withTransaction(async (transaction) => {
      const token = await this.repositories.findPasswordResetTokenByHash(tokenHash, { executor: transaction });
      if (!token || !isUsableToken(token)) throw new AuthInvalidTokenError();
      const user = await this.repositories.findUserById(token.userId, { executor: transaction });
      if (!user || user.status !== "active") throw new AuthInvalidTokenError();
      await this.repositories.upsertPasswordCredential({ userId: user.userId, passwordHash }, { executor: transaction });
      try {
        await this.repositories.markPasswordResetTokenUsed(token.tokenId, new Date(), { executor: transaction });
      } catch (error) {
        if (error instanceof AuthNotFoundError) throw new AuthInvalidTokenError();
        throw error;
      }
      await this.repositories.revokeActiveSessionsForUser(user.userId, new Date(), { executor: transaction });
    });

    return { completed: true };
  }
}
