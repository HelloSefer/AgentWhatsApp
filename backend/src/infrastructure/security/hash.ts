import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Hashes high-entropy opaque tokens before persistence.
 * This is not password hashing; password hashing belongs to Phase 9B.
 */
export function hashOpaqueTokenSha256Hex(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function timingSafeOpaqueTokenHashEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
