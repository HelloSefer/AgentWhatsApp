import type { Request } from "express";
import { normalizeConnectionId } from "../domain/whatsapp-connection.validation";
import { WhatsAppConnectionValidationError } from "../domain/whatsapp-connection.errors";

export type WhatsAppConnectionProductBindingValidationCode =
  | "INVALID_OBJECT"
  | "UNKNOWN_PROPERTY"
  | "FORBIDDEN_PROPERTY"
  | "REQUIRED"
  | "INVALID_QUERY"
  | "INVALID_CONNECTION_ID"
  | "INVALID_PRODUCT_ID";

export class WhatsAppConnectionProductBindingHttpValidationError extends Error {
  constructor(readonly issues: readonly Readonly<{ field: string; code: WhatsAppConnectionProductBindingValidationCode }>[]) {
    super("Invalid product binding request.");
    this.name = "WhatsAppConnectionProductBindingHttpValidationError";
  }
}

const FORBIDDEN_FIELDS = new Set([
  "sellerId", "workspaceId", "tenantId", "membershipId", "role", "ownerId", "ownership", "workspace", "seller",
  "phoneNumberId", "wabaId", "webhookId", "credentialId", "accessToken", "token", "encryptedAccessToken",
]);

function fail(field: string, code: WhatsAppConnectionProductBindingValidationCode): never {
  throw new WhatsAppConnectionProductBindingHttpValidationError([{ field, code }]);
}

function hasBody(req: Request): boolean {
  const length = req.headers["content-length"];
  return req.body !== undefined || (typeof length === "string" && length !== "0") || Array.isArray(length) || req.headers["transfer-encoding"] !== undefined;
}

function assertEmptyQuery(req: Request): void {
  if (Object.keys(req.query).length > 0) fail("query", "INVALID_QUERY");
}

export function parseProductBindingConnectionId(value: unknown): string {
  try {
    return normalizeConnectionId(value);
  } catch (error) {
    if (error instanceof WhatsAppConnectionValidationError) fail("connectionId", "INVALID_CONNECTION_ID");
    throw error;
  }
}

export function parseProductBindingReadRequest(req: Request): void {
  assertEmptyQuery(req);
  if (hasBody(req)) fail("body", "INVALID_OBJECT");
}

export function parseProductBindingClearRequest(req: Request): void {
  assertEmptyQuery(req);
  if (hasBody(req)) fail("body", "INVALID_OBJECT");
}

export function parseProductBindingWriteRequest(req: Request): string {
  assertEmptyQuery(req);
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("body", "INVALID_OBJECT");
  const record = body as Record<string, unknown>;
  const issues: Array<{ field: string; code: WhatsAppConnectionProductBindingValidationCode }> = [];
  for (const field of Object.keys(record)) {
    if (FORBIDDEN_FIELDS.has(field)) issues.push({ field, code: "FORBIDDEN_PROPERTY" });
    else if (field !== "productId") issues.push({ field, code: "UNKNOWN_PROPERTY" });
  }
  if (issues.length) throw new WhatsAppConnectionProductBindingHttpValidationError(issues);
  if (!("productId" in record)) fail("productId", "REQUIRED");
  if (typeof record.productId !== "string") fail("productId", "INVALID_PRODUCT_ID");
  const productId = record.productId.trim();
  if (!productId || productId.length > 128) fail("productId", "INVALID_PRODUCT_ID");
  return productId;
}
