import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type {
  GoogleAuthorizationUrlInput,
  GoogleIdentityCallbackInput,
  GoogleIdentityProvider,
  VerifiedGoogleIdentity,
} from "../../contracts/google-identity.provider";
import { AuthInvalidTokenError } from "../../domain/auth.errors";

const ACCEPTED_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export class GoogleOAuthIdentityProvider implements GoogleIdentityProvider {
  private readonly client: OAuth2Client;

  constructor(
    private readonly clientId: string,
    clientSecret: string,
  ) {
    this.client = new OAuth2Client(clientId, clientSecret);
  }

  buildAuthorizationUrl(input: GoogleAuthorizationUrlInput): string {
    return this.client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      response_type: "code",
      prompt: "select_account",
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      redirect_uri: input.redirectUri,
    });
  }

  async exchangeCodeForIdentity(input: GoogleIdentityCallbackInput): Promise<VerifiedGoogleIdentity> {
    const { tokens } = await this.client.getToken({
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    if (!tokens.id_token) throw new AuthInvalidTokenError();

    const ticket = await this.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new AuthInvalidTokenError();

    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const expiresAtSeconds = typeof payload.exp === "number" ? payload.exp : 0;
    if (
      !payload.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      payload.nonce !== input.nonce ||
      !ACCEPTED_ISSUERS.has(String(payload.iss)) ||
      !audience.includes(this.clientId) ||
      expiresAtSeconds * 1000 <= Date.now()
    ) {
      throw new AuthInvalidTokenError();
    }

    return {
      provider: "google",
      providerSubject: payload.sub,
      email: payload.email,
      emailVerified: true,
    };
  }
}
