import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import dotenv from "dotenv";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, runDatabaseMigrations } from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { PostgreSqlAuthRepository, PasswordAuthService, SessionAuthService, type AuthRole, type AuthUser } from "../../auth";
import { AUTH_COOKIE_NAME } from "../../auth/http/auth-cookie";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { createCatalogProductRoutes } from "../catalog-products.routes";

dotenv.config();
const cases: { name: string; passed: boolean }[] = [];
const sellers: string[] = []; const users: string[] = [];
const add = (name: string, passed: boolean) => cases.push({ name, passed });
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/gu, "")}`;
type Reply = { status: number; body: Record<string, unknown>; text: string };

function product(productId: string, changes: Record<string, unknown> = {}): Record<string, unknown> {
  return { productId, name: "Sandale", description: "Premium", price: { amountMinor: 23_300, currencyCode: "MAD" }, availability: "available", options: [{ optionId: "color", label: "Color", required: true, position: 0, values: [{ valueId: "black", label: "Black", position: 0, isAvailable: true }] }], aliases: ["Sandale Femme"], offers: [{ offerId: "bundle", label: "Two", requiredItemCount: 2, totalPriceAmountMinor: 40_000, active: true, allowMixedOptions: false, priority: 0 }], ...changes };
}
function start(app: express.Express): Promise<{ server: Server; base: string }> { return new Promise((resolve) => { const server = createServer(app).listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") throw new Error("No address"); resolve({ server, base: `http://127.0.0.1:${address.port}` }); }); }); }
function stop(server: Server): Promise<void> { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
async function request(base: string, path: string, method = "GET", body?: unknown, cookie?: string): Promise<Reply> { const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); let parsed: Record<string, unknown> = {}; try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* bounded test parser */ } return { status: response.status, body: parsed, text }; }
async function user(repository: PostgreSqlAuthRepository, prefix: string, label: string): Promise<AuthUser> { const result = await repository.createUser({ userId: randomUUID(), emailNormalized: `${prefix}_${label}@example.com`, status: "active" }); users.push(result.userId); return result; }
async function cookie(service: SessionAuthService, entry: AuthUser): Promise<string> { return `${AUTH_COOKIE_NAME}=${(await service.issueSessionForUser(entry)).session.rawToken}`; }
async function membership(repository: PostgreSqlAuthRepository, sellerId: string, entry: AuthUser, role: AuthRole): Promise<void> { await repository.createSellerMembership({ sellerId, userId: entry.userId, role, status: "active" }); }

async function main(): Promise<void> {
  await closeDatabasePool(); await runDatabaseMigrations();
  const authRepository = new PostgreSqlAuthRepository(); const passwords = new PasswordAuthService(authRepository); const sessions = new SessionAuthService(authRepository, passwords);
  const persistence = createPersistenceComposition(); const app = express(); app.use(express.json()); app.use("/api/seller", createCatalogProductRoutes(createAuthComposition(), persistence));
  const { server, base } = await start(app); const prefix = id("d4b2");
  try {
    const sellerA = id("seller_d4b2_a"), sellerB = id("seller_d4b2_b"); sellers.push(sellerA, sellerB);
    await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerA) }); await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerB) });
    const owner = await user(authRepository, prefix, "owner"), admin = await user(authRepository, prefix, "admin"), agent = await user(authRepository, prefix, "agent"), viewer = await user(authRepository, prefix, "viewer"), ownerB = await user(authRepository, prefix, "owner_b");
    await membership(authRepository, sellerA, owner, "OWNER"); await membership(authRepository, sellerA, admin, "ADMIN"); await membership(authRepository, sellerA, agent, "AGENT"); await membership(authRepository, sellerA, viewer, "VIEWER"); await membership(authRepository, sellerB, ownerB, "OWNER");
    const ownerCookie = await cookie(sessions, owner), adminCookie = await cookie(sessions, admin), agentCookie = await cookie(sessions, agent), viewerCookie = await cookie(sessions, viewer), ownerBCookie = await cookie(sessions, ownerB);
    const productId = id("product");
    add("Unauthenticated routes return 401", (await request(base, "/api/seller/products")).status === 401 && (await request(base, "/api/seller/products", "POST", product(productId))).status === 401);
    const created = await request(base, "/api/seller/products", "POST", product(productId), ownerCookie);
    add("OWNER atomically creates the complete writable aggregate", created.status === 201 && Array.isArray(created.body.options) && Array.isArray(created.body.offers) && Array.isArray(created.body.images) && (created.body.images as unknown[]).length === 0);
    add("Response hides tenant and normalized alias authority", !("sellerId" in created.body) && !JSON.stringify(created.body).includes("normalizedAlias") && !JSON.stringify(created.body).includes("currencyCode\":\"MAD\",\"active"));
    add("AGENT and VIEWER can read but cannot write", (await request(base, "/api/seller/products", "GET", undefined, agentCookie)).status === 200 && (await request(base, `/api/seller/products/${productId}`, "GET", undefined, viewerCookie)).status === 200 && (await request(base, "/api/seller/products", "POST", product(id("denied")), agentCookie)).status === 403 && (await request(base, "/api/seller/products", "POST", product(id("denied")), viewerCookie)).status === 403);
    add("ADMIN can write", (await request(base, "/api/seller/products", "POST", product(id("admin"), { aliases: ["Admin Alias"] }), adminCookie)).status === 201);
    add("Strict tenant and unknown fields are rejected", (await request(base, "/api/seller/products", "POST", product(id("forbidden"), { sellerId: sellerB }), ownerCookie)).status === 400 && (await request(base, "/api/seller/products?offset=1", "GET", undefined, ownerCookie)).status === 400);
    add("Malformed DTO returns 400 and semantic Catalog validation returns 422", (await request(base, "/api/seller/products", "POST", { productId: id("bad") }, ownerCookie)).status === 400 && (await request(base, "/api/seller/products", "POST", product(id("semantic"), { options: [{ optionId: "x", label: "X", required: true, position: 0, values: [] }, { optionId: "y", label: "Y", required: true, position: 0, values: [] }] }), ownerCookie)).status === 422);
    add("Duplicate product and alias conflicts are safe", (await request(base, "/api/seller/products", "POST", product(productId), ownerCookie)).body.errors !== undefined && (await request(base, "/api/seller/products", "POST", product(id("alias"), { aliases: ["sandale   femme"] }), ownerCookie)).status === 409);
    const sellerBProduct = await request(base, "/api/seller/products", "POST", product(productId), ownerBCookie);
    add("Same product ID and normalized alias are allowed across sellers", sellerBProduct.status === 201);
    const privateId = id("private"); await request(base, "/api/seller/products", "POST", product(privateId, { aliases: ["Private Alias"] }), ownerCookie);
    add("Cross-tenant read, replacement, and availability are non-leaking 404", (await request(base, `/api/seller/products/${privateId}`, "GET", undefined, ownerBCookie)).status === 404 && (await request(base, `/api/seller/products/${privateId}`, "PUT", { name: "Nope", description: null, price: { amountMinor: 1, currencyCode: "MAD" }, availability: "available", options: [], aliases: [], offers: [] }, ownerBCookie)).status === 404 && (await request(base, `/api/seller/products/${privateId}/availability`, "PATCH", { availability: "unavailable" }, ownerBCookie)).status === 404);
    const missing = await request(base, `/api/seller/products/${id("missing")}`, "GET", undefined, ownerCookie); const foreign = await request(base, `/api/seller/products/${id("foreign")}`, "GET", undefined, ownerCookie);
    add("Missing and foreign-shaped reads use the same 404 envelope", missing.status === 404 && foreign.status === 404 && missing.text === foreign.text);
    const putBody = product(productId, { name: "Replaced", description: null, options: [], aliases: [], offers: [] }); delete putBody.productId;
    const replaced = await request(base, `/api/seller/products/${productId}`, "PUT", putBody, ownerCookie);
    add("PUT fully replaces writable collections and is repeat-safe", replaced.status === 200 && (replaced.body.options as unknown[]).length === 0 && (await request(base, `/api/seller/products/${productId}`, "PUT", putBody, ownerCookie)).status === 200);
    add("PUT rejects identity and image writes", (await request(base, `/api/seller/products/${productId}`, "PUT", product(productId), ownerCookie)).status === 400 && (await request(base, `/api/seller/products/${productId}`, "PUT", { ...putBody, images: [] }, ownerCookie)).status === 400);
    const imageProductId = id("image_product");
    await persistence.catalogService.createProduct(createTenantContext(sellerA), { ...product(imageProductId, { aliases: ["Image Alias"] }), images: [{ objectKey: `product-images/${sellerA}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`, mimeType: "image/png", position: 0 }] } as never);
    const imagePut = product(imageProductId, { name: "Image retained", description: "Updated" }); delete imagePut.productId;
    const imageUpdated = await request(base, `/api/seller/products/${imageProductId}`, "PUT", imagePut, ownerCookie);
    add("PUT preserves persisted image metadata without storage operations", imageUpdated.status === 200 && Array.isArray(imageUpdated.body.images) && (imageUpdated.body.images as { objectKey?: string }[])[0]?.objectKey === `product-images/${sellerA}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`);
    add("Availability PATCH is strict, final-state safe, and seller-readable", (await request(base, `/api/seller/products/${productId}/availability`, "PATCH", { availability: "unavailable" }, ownerCookie)).status === 200 && (await request(base, `/api/seller/products/${productId}/availability`, "PATCH", { availability: "unavailable" }, ownerCookie)).status === 200 && (await request(base, `/api/seller/products/${productId}`, "GET", undefined, agentCookie)).status === 200 && (await request(base, `/api/seller/products/${productId}/availability`, "PATCH", { availability: "archived" }, ownerCookie)).status === 400);
    add("List uses bounded deterministic keyset pagination", (await request(base, "/api/seller/products?limit=1", "GET", undefined, ownerCookie)).status === 200 && (await request(base, "/api/seller/products?limit=101", "GET", undefined, ownerCookie)).status === 422);
  } finally {
    await stop(server); if (sellers.length) await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = ANY($1::varchar[])", values: [sellers] }); if (sellers.length) await executeDatabaseQuery({ text: "DELETE FROM seller_memberships WHERE seller_id = ANY($1::varchar[])", values: [sellers] }); if (sellers.length) await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellers] }); if (users.length) await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [users] }); await closeDatabasePool();
  }
  const failed = cases.filter((entry) => !entry.passed); process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`); process.exitCode = failed.length ? 1 : 0;
}
main().catch(async (error) => { await closeDatabasePool(); process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "D4-B2 API test failed.", cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined })}\n`); process.exitCode = 1; });
