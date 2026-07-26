import type { Response } from "express";
import { env } from "../../../config/env";
import { AUTH_SESSION_TTL_MS } from "../application/session-auth.service";

export const AUTH_COOKIE_NAME = "agentwhatsapp_session";

type CookieAttributes = Readonly<{
  httpOnly: true;
  path: "/";
  sameSite: "lax";
  secure: boolean;
  maxAge?: number;
}>;

function attributes(maxAge?: number): CookieAttributes {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    maxAge,
  };
}

export function setAuthCookie(res: Response, rawToken: string): void {
  res.cookie(AUTH_COOKIE_NAME, rawToken, attributes(AUTH_SESSION_TTL_MS));
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, attributes());
}

export function readAuthCookie(cookieHeader: unknown): string | undefined {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 4096) return undefined;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [name, ...rawValue] = pair.trim().split("=");
    if (name === AUTH_COOKIE_NAME) return rawValue.join("=");
  }
  return undefined;
}
