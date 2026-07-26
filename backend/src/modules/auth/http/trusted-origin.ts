import type { Request } from "express";
import { env } from "../../../config/env";

export function trustedFrontendOrigin(): string | undefined {
  if (!env.frontendBaseUrl) return undefined;
  try {
    return new URL(env.frontendBaseUrl).origin;
  } catch {
    return undefined;
  }
}

export function isTrustedOrigin(value: unknown): boolean {
  const trusted = trustedFrontendOrigin();
  return typeof value === "string" && Boolean(trusted) && value === trusted;
}

export function requestHasAuthCookie(req: Request): boolean {
  return typeof req.headers.cookie === "string" && req.headers.cookie.includes("agentwhatsapp_session=");
}
