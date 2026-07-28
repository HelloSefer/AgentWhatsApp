import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMetaSignature(rawBody: Buffer | undefined, appSecret: string, signature: string | undefined): boolean {
  if (!rawBody || !signature || !signature.startsWith(SIGNATURE_PREFIX)) return false;
  const digest = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/u.test(digest)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return timingSafeStringEqual(digest, expected);
}

