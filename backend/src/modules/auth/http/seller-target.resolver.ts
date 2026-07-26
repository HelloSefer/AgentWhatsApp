import type { Request } from "express";
import { AuthorizationInvalidSellerTargetError } from "../application/authorization.errors";

type SellerTargetSource = "params" | "query" | "body";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function bodyRecord(req: Request): Record<string, unknown> | undefined {
  return typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : undefined;
}

function sellerIdFrom(req: Request, source: SellerTargetSource): string | undefined {
  if (source === "params") return text(req.params.sellerId);
  if (source === "query") return text(req.query.sellerId);
  return text(bodyRecord(req)?.sellerId);
}

export function resolveRequestedSellerTarget(req: Request): string | undefined {
  const values = (["params", "query", "body"] as const)
    .map((source) => sellerIdFrom(req, source))
    .filter((value): value is string => value !== undefined);

  if (values.length === 0) return undefined;
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value)) throw new AuthorizationInvalidSellerTargetError();
  const [first] = normalized;
  if (normalized.some((value) => value !== first)) throw new AuthorizationInvalidSellerTargetError();
  return first;
}
