import { randomBytes } from "node:crypto";
import { hashOpaqueTokenSha256Hex } from "./hash";

const TOKEN_BYTES = 32;

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOpaqueToken(token: unknown): string | null {
  if (typeof token !== "string" || !token || token.length > 512) return null;
  return hashOpaqueTokenSha256Hex(token);
}
