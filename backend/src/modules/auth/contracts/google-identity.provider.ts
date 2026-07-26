export type GoogleAuthorizationUrlInput = Readonly<{
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}>;

export type GoogleIdentityCallbackInput = Readonly<{
  code: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}>;

export type VerifiedGoogleIdentity = Readonly<{
  provider: "google";
  providerSubject: string;
  email: string;
  emailVerified: boolean;
}>;

export interface GoogleIdentityProvider {
  buildAuthorizationUrl(input: GoogleAuthorizationUrlInput): string;
  exchangeCodeForIdentity(input: GoogleIdentityCallbackInput): Promise<VerifiedGoogleIdentity>;
}
