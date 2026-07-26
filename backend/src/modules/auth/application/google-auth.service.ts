import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { withTransaction } from "../../../infrastructure/database";
import type { AuthRepositories } from "../contracts/auth.repository";
import type { GoogleIdentityProvider, VerifiedGoogleIdentity } from "../contracts/google-identity.provider";
import {
  AuthAlreadyExistsError,
  AuthInvalidCredentialsError,
  AuthInvalidTokenError,
  AuthValidationError,
} from "../domain/auth.errors";
import type { AuthUser } from "../domain/auth.types";
import { normalizeEmail, validateProviderSubject } from "../domain/auth.validation";
import { SessionAuthService } from "./session-auth.service";
import type { GoogleAuthCallbackInput, GoogleAuthCallbackResult, GoogleAuthConfiguration, GoogleAuthStartResult } from "./google-auth.types";

const GOOGLE_PROVIDER = "google";
const DEFAULT_POST_LOGIN_PATH = "/reseller/dashboard";

export class GoogleAuthUnavailableError extends Error {
  constructor() {
    super("Google authentication is not configured.");
    this.name = "GoogleAuthUnavailableError";
  }
}

function base64UrlRandom(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function createPkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function safePostLoginPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\u0000")) return DEFAULT_POST_LOGIN_PATH;
  return value;
}

function redirectUrl(configuration: Readonly<{ frontendBaseUrl?: string; postLoginPath: string }>): string {
  if (!configuration.frontendBaseUrl) throw new GoogleAuthUnavailableError();
  return new URL(safePostLoginPath(configuration.postLoginPath), configuration.frontendBaseUrl).toString();
}

function validatedConfiguration(configuration: GoogleAuthConfiguration): Required<Omit<GoogleAuthConfiguration, "enabled">> {
  if (!configuration.enabled || !configuration.clientId || !configuration.clientSecret || !configuration.callbackUrl || !configuration.frontendBaseUrl) {
    throw new GoogleAuthUnavailableError();
  }
  return {
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
    callbackUrl: configuration.callbackUrl,
    frontendBaseUrl: configuration.frontendBaseUrl,
    postLoginPath: safePostLoginPath(configuration.postLoginPath),
  };
}

function validateCallbackInput(input: GoogleAuthCallbackInput): Required<GoogleAuthCallbackInput> {
  if (!input.code || !input.state || !input.stateCookie || !input.nonceCookie || !input.codeVerifierCookie) throw new AuthValidationError();
  if (!constantTimeEqual(input.stateCookie, input.state)) throw new AuthValidationError();
  return {
    code: input.code,
    state: input.state,
    stateCookie: input.stateCookie,
    nonceCookie: input.nonceCookie,
    codeVerifierCookie: input.codeVerifierCookie,
  };
}

function validateIdentity(identity: VerifiedGoogleIdentity): { providerSubject: string; emailNormalized: string } {
  if (identity.provider !== GOOGLE_PROVIDER) throw new AuthInvalidTokenError();
  const providerSubject = validateProviderSubject(identity.providerSubject);
  if (!identity.emailVerified) throw new AuthInvalidCredentialsError();
  return { providerSubject, emailNormalized: normalizeEmail(identity.email) };
}

export class GoogleAuthService {
  constructor(
    private readonly repositories: AuthRepositories,
    private readonly sessionAuthService: SessionAuthService,
    private readonly provider: GoogleIdentityProvider,
    private readonly configuration: GoogleAuthConfiguration,
  ) {}

  start(): GoogleAuthStartResult {
    const configuration = validatedConfiguration(this.configuration);
    const state = base64UrlRandom();
    const nonce = base64UrlRandom();
    const codeVerifier = base64UrlRandom(64);
    const authorizationUrl = this.provider.buildAuthorizationUrl({
      state,
      nonce,
      codeChallenge: createPkceChallenge(codeVerifier),
      redirectUri: configuration.callbackUrl,
    });
    return { authorizationUrl, state, nonce, codeVerifier };
  }

  async callback(input: GoogleAuthCallbackInput): Promise<GoogleAuthCallbackResult> {
    const configuration = validatedConfiguration(this.configuration);
    const callbackInput = validateCallbackInput(input);
    const identity = validateIdentity(await this.provider.exchangeCodeForIdentity({
      code: callbackInput.code,
      nonce: callbackInput.nonceCookie,
      codeVerifier: callbackInput.codeVerifierCookie,
      redirectUri: configuration.callbackUrl,
    }));
    const user = await this.resolveOrCreateUser(identity);
    const sessionResult = await this.sessionAuthService.issueSessionForUser(user);
    return { ...sessionResult, redirectUrl: redirectUrl(configuration) };
  }

  private async resolveOrCreateUser(identity: { providerSubject: string; emailNormalized: string }): Promise<AuthUser> {
    const existingIdentity = await this.repositories.findExternalIdentity(GOOGLE_PROVIDER, identity.providerSubject);
    if (existingIdentity) {
      const user = await this.repositories.findUserById(existingIdentity.userId);
      if (!user || user.status !== "active") throw new AuthInvalidCredentialsError();
      return user;
    }

    try {
      return await withTransaction(async (transaction) => {
        const linkedIdentity = await this.repositories.findExternalIdentity(GOOGLE_PROVIDER, identity.providerSubject, { executor: transaction });
        if (linkedIdentity) {
          const linkedUser = await this.repositories.findUserById(linkedIdentity.userId, { executor: transaction });
          if (!linkedUser || linkedUser.status !== "active") throw new AuthInvalidCredentialsError();
          return linkedUser;
        }

        const existingUser = await this.repositories.findUserByEmail(identity.emailNormalized, { executor: transaction });
        if (existingUser) {
          if (existingUser.status !== "active") throw new AuthInvalidCredentialsError();
          if (!existingUser.emailVerifiedAt) await this.repositories.markEmailVerified(existingUser.userId, new Date(), { executor: transaction });
          await this.repositories.createExternalIdentity({
            externalIdentityId: randomUUID(),
            userId: existingUser.userId,
            provider: GOOGLE_PROVIDER,
            providerSubject: identity.providerSubject,
            emailNormalized: identity.emailNormalized,
          }, { executor: transaction });
          return existingUser.emailVerifiedAt ? existingUser : await this.repositories.findUserById(existingUser.userId, { executor: transaction }) ?? existingUser;
        }

        const created = await this.repositories.createUser({
          userId: randomUUID(),
          emailNormalized: identity.emailNormalized,
          status: "active",
        }, { executor: transaction });
        const verified = await this.repositories.markEmailVerified(created.userId, new Date(), { executor: transaction });
        await this.repositories.createExternalIdentity({
          externalIdentityId: randomUUID(),
          userId: verified.userId,
          provider: GOOGLE_PROVIDER,
          providerSubject: identity.providerSubject,
          emailNormalized: identity.emailNormalized,
        }, { executor: transaction });
        return verified;
      });
    } catch (error) {
      if (!(error instanceof AuthAlreadyExistsError)) throw error;
      const racedIdentity = await this.repositories.findExternalIdentity(GOOGLE_PROVIDER, identity.providerSubject);
      if (racedIdentity) {
        const user = await this.repositories.findUserById(racedIdentity.userId);
        if (!user || user.status !== "active") throw new AuthInvalidCredentialsError();
        return user;
      }
      const racedUser = await this.repositories.findUserByEmail(identity.emailNormalized);
      if (!racedUser || racedUser.status !== "active") throw new AuthInvalidCredentialsError();
      return this.resolveOrCreateUser(identity);
    }
  }
}
