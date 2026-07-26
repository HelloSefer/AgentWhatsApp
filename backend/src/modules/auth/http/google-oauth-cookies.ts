import type { Request, Response } from "express";
import { env } from "../../../config/env";

export const GOOGLE_OAUTH_COOKIE_PATH = "/api/auth/google";
export const GOOGLE_OAUTH_MAX_AGE_MS = 10 * 60 * 1000;
export const GOOGLE_OAUTH_STATE_COOKIE = "agentwhatsapp_google_state";
export const GOOGLE_OAUTH_NONCE_COOKIE = "agentwhatsapp_google_nonce";
export const GOOGLE_OAUTH_PKCE_COOKIE = "agentwhatsapp_google_pkce";

type TransientCookieName =
  typeof GOOGLE_OAUTH_STATE_COOKIE |
  typeof GOOGLE_OAUTH_NONCE_COOKIE |
  typeof GOOGLE_OAUTH_PKCE_COOKIE;

const cookieAttributes = Object.freeze({
  httpOnly: true,
  path: GOOGLE_OAUTH_COOKIE_PATH,
  sameSite: "lax" as const,
  secure: env.nodeEnv === "production",
  maxAge: GOOGLE_OAUTH_MAX_AGE_MS,
});

const clearAttributes = Object.freeze({
  httpOnly: true,
  path: GOOGLE_OAUTH_COOKIE_PATH,
  sameSite: "lax" as const,
  secure: env.nodeEnv === "production",
});

function readCookie(cookieHeader: unknown, name: TransientCookieName): string | undefined {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 4096) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [cookieName, ...rawValue] = pair.trim().split("=");
    if (cookieName === name) return rawValue.join("=");
  }
  return undefined;
}

export function setGoogleOAuthCookies(res: Response, input: Readonly<{ state: string; nonce: string; codeVerifier: string }>): void {
  res.cookie(GOOGLE_OAUTH_STATE_COOKIE, input.state, cookieAttributes);
  res.cookie(GOOGLE_OAUTH_NONCE_COOKIE, input.nonce, cookieAttributes);
  res.cookie(GOOGLE_OAUTH_PKCE_COOKIE, input.codeVerifier, cookieAttributes);
}

export function clearGoogleOAuthCookies(res: Response): void {
  res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, clearAttributes);
  res.clearCookie(GOOGLE_OAUTH_NONCE_COOKIE, clearAttributes);
  res.clearCookie(GOOGLE_OAUTH_PKCE_COOKIE, clearAttributes);
}

export function readGoogleOAuthCookies(req: Request): Readonly<{ stateCookie?: string; nonceCookie?: string; codeVerifierCookie?: string }> {
  const header = req.headers.cookie;
  return {
    stateCookie: readCookie(header, GOOGLE_OAUTH_STATE_COOKIE),
    nonceCookie: readCookie(header, GOOGLE_OAUTH_NONCE_COOKIE),
    codeVerifierCookie: readCookie(header, GOOGLE_OAUTH_PKCE_COOKIE),
  };
}
