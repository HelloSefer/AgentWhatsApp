import { createHash } from "node:crypto";
import { QueueJobIdentityError } from "../errors/queue.errors";
import type { DeterministicJobId } from "./queue.types";

const UNSAFE_JOB_ID_PATTERN = /[\s{}()[\]/\\:;,'"`$|<>]/u;

export function validateDeterministicJobId(value: unknown): DeterministicJobId {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 128 ||
    UNSAFE_JOB_ID_PATTERN.test(value)
  ) {
    throw new QueueJobIdentityError();
  }
  return value as DeterministicJobId;
}

function normalizePart(part: unknown): string {
  if (typeof part !== "string" && typeof part !== "number" && typeof part !== "boolean") {
    throw new QueueJobIdentityError();
  }
  const normalized = String(part).trim();
  if (!normalized || UNSAFE_JOB_ID_PATTERN.test(normalized)) {
    throw new QueueJobIdentityError();
  }
  return normalized;
}

export function buildDeterministicJobId(parts: readonly unknown[]): DeterministicJobId {
  if (!Array.isArray(parts) || parts.length === 0) throw new QueueJobIdentityError();
  const normalizedParts = parts.map(normalizePart);
  const digest = createHash("sha256")
    .update(JSON.stringify(normalizedParts))
    .digest("hex")
    .slice(0, 48);
  return validateDeterministicJobId(`jid_${digest}`);
}
