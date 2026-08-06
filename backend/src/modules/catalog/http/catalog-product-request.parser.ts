import type { CatalogProductInput } from "../domain/catalog-product";

export class CatalogProductHttpValidationError extends Error {
  constructor(readonly issues: readonly Readonly<{ field: string; code: string }>[]) {
    super("Invalid product request.");
    this.name = "CatalogProductHttpValidationError";
  }
}

type RecordValue = Record<string, unknown>;
const FORBIDDEN = new Set(["sellerId", "workspaceId", "tenantId", "membershipId", "role", "ownerId", "ownership", "workspace", "seller", "createdAt", "updatedAt", "version", "configVersion", "normalizedAlias"]);

function record(value: unknown, field = "body"): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogProductHttpValidationError([{ field, code: "INVALID_OBJECT" }]);
  return value as RecordValue;
}

function strict(value: RecordValue, allowed: readonly string[]): void {
  const issues: { field: string; code: string }[] = [];
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key)) issues.push({ field: key, code: "FORBIDDEN_PROPERTY" });
    else if (!allowed.includes(key)) issues.push({ field: key, code: "UNKNOWN_PROPERTY" });
  }
  if (issues.length) throw new CatalogProductHttpValidationError(issues);
}

function requireFields(value: RecordValue, fields: readonly string[]): void {
  const issues = fields.filter((field) => value[field] === undefined).map((field) => ({ field, code: "REQUIRED" }));
  if (issues.length) throw new CatalogProductHttpValidationError(issues);
}

function productPath(productId: unknown): string {
  if (typeof productId !== "string" || !productId.trim() || productId.trim().length > 128) throw new CatalogProductHttpValidationError([{ field: "productId", code: "INVALID_PRODUCT_ID" }]);
  return productId.trim();
}

function structuralProduct(value: RecordValue, fields: readonly string[]): void {
  const issues: { field: string; code: string }[] = [];
  for (const field of ["options", "aliases", "offers"] as const) if (value[field] !== undefined && !Array.isArray(value[field])) issues.push({ field, code: "INVALID_ARRAY" });
  if (value.description !== undefined && value.description !== null && typeof value.description !== "string") issues.push({ field: "description", code: "INVALID_TEXT" });
  if (value.price !== undefined && (!value.price || typeof value.price !== "object" || Array.isArray(value.price))) issues.push({ field: "price", code: "INVALID_OBJECT" });
  if (issues.length) throw new CatalogProductHttpValidationError(issues);
  requireFields(value, fields);
}

export function parseCatalogProductCreate(value: unknown): CatalogProductInput {
  const body = record(value);
  strict(body, ["productId", "name", "description", "price", "availability", "options", "aliases", "offers"]);
  structuralProduct(body, ["productId", "name", "price", "availability"]);
  return { ...body, images: [] } as CatalogProductInput;
}

export function parseCatalogProductReplace(value: unknown, productId: unknown): CatalogProductInput {
  const body = record(value);
  strict(body, ["name", "description", "price", "availability", "options", "aliases", "offers"]);
  structuralProduct(body, ["name", "description", "price", "availability", "options", "aliases", "offers"]);
  return { ...body, productId: productPath(productId) } as CatalogProductInput;
}

export function parseCatalogProductAvailability(value: unknown): "available" | "unavailable" {
  const body = record(value);
  strict(body, ["availability"]);
  requireFields(body, ["availability"]);
  if (body.availability !== "available" && body.availability !== "unavailable") throw new CatalogProductHttpValidationError([{ field: "availability", code: "INVALID_AVAILABILITY" }]);
  return body.availability;
}

export function parseCatalogProductQuery(value: unknown): Readonly<{ limit?: number; cursor?: string }> {
  const query = record(value, "query");
  strict(query, ["limit", "cursor"]);
  const issues: { field: string; code: string }[] = [];
  let limit: number | undefined;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d+$/u.test(query.limit)) issues.push({ field: "limit", code: "INVALID_LIMIT" });
    else limit = Number(query.limit);
  }
  if (query.cursor !== undefined && (typeof query.cursor !== "string" || !query.cursor.trim())) issues.push({ field: "cursor", code: "INVALID_CURSOR" });
  if (issues.length) throw new CatalogProductHttpValidationError(issues);
  return { ...(limit === undefined ? {} : { limit }), ...(typeof query.cursor === "string" ? { cursor: query.cursor } : {}) };
}

export function parseCatalogProductPath(value: unknown): string {
  return productPath(value);
}
