import type { SessionIssueResult } from "./session-auth.types";

export type GoogleAuthConfiguration = Readonly<{
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  frontendBaseUrl?: string;
  postLoginPath: string;
}>;

export type GoogleAuthStartResult = Readonly<{
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}>;

export type GoogleAuthCallbackInput = Readonly<{
  code?: string;
  state?: string;
  stateCookie?: string;
  nonceCookie?: string;
  codeVerifierCookie?: string;
}>;

export type GoogleAuthCallbackResult = SessionIssueResult & Readonly<{
  redirectUrl: string;
}>;
