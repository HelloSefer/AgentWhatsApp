import { randomUUID } from "node:crypto";
import { createServer, request as nodeRequest, type Server } from "node:http";
import express from "express";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import {
  AuthRole,
  PasswordAuthService,
  PostgreSqlAuthRepository,
  SessionAuthService,
  type AuthUser,
} from "../../auth";
import { AUTH_COOKIE_NAME } from "../../auth/http/auth-cookie";
import { CatalogService, PostgreSqlCatalogRepository, ProductNotFoundError } from "../../catalog";
import { ConversationConfigService, PostgreSqlConversationConfigRepository } from "../../conversation-config";
import { SellerCommerceConfigRepository } from "../../seller-commerce-config";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionProductBindingService,
  WhatsAppConnectionSellerNotFoundError,
  type WhatsAppConnectionRepository,
} from "../index";
import { createWhatsAppConnectionRoutes } from "../whatsapp-connection.routes";
import { sendWhatsAppConnectionProductBindingValidationError } from "../http/whatsapp-connection-http.errors";

dotenv.config();

type Reply = Readonly<{ status: number; body: Record<string, unknown>; text: string }>;
type TestCase = Readonly<{ name: string; passed: boolean }>;

const cases: TestCase[] = [];
const sellers: string[] = [];
const users: string[] = [];
const add = (name: string, passed: boolean) => cases.push({ name, passed });
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/gu, "")}`;

function commerceConfig(sellerId: string) {
  return {
    configVersion: 1,
    payment: { method: "COD", enabled: true },
    delivery: { enabled: true, availability: "all_cities", pricing: { mode: "ALL_FREE", currency: "MAD" } },
    requiredCustomerFields: [{ key: "fullName", label: "Name", required: true, enabled: true }],
    orderBehavior: { multiItemOrderFlow: { enabled: true, runtimeMode: "guarded", allowedSellerIds: [sellerId] } },
    receipt: { enabled: true, sendAfterConfirmation: true },
  };
}

function product(productId: string, name: string, availability: "available" | "unavailable" = "available") {
  return { productId, name, description: "API acceptance product", price: { amountMinor: 19_900, currencyCode: "MAD" }, availability, options: [], images: [], aliases: [], offers: [] };
}

function start(app: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(app).listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test address.");
      resolve({ server, base: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stop(server: Server): Promise<void> { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

async function request(base: string, path: string, input: Readonly<{ method?: string; body?: unknown; rawBody?: string; cookie?: string }> = {}): Promise<Reply> {
  const url = new URL(path, base);
  const rawBody = input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body));
  return new Promise((resolve, reject) => {
    const req = nodeRequest(url, {
      method: input.method || "GET",
      headers: {
        ...(rawBody === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(rawBody).toString() }),
        ...(input.cookie ? { cookie: input.cookie } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: Record<string, unknown> = {};
        try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* bounded test parser */ }
        resolve({ status: res.statusCode || 0, body, text });
      });
    });
    req.on("error", reject);
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

async function user(repository: PostgreSqlAuthRepository, prefix: string, label: string): Promise<AuthUser> {
  const result = await repository.createUser({ userId: randomUUID(), emailNormalized: `${prefix}_${label}@example.com`, status: "active" });
  users.push(result.userId);
  return result;
}

async function cookie(sessions: SessionAuthService, entry: AuthUser): Promise<string> {
  return `${AUTH_COOKIE_NAME}=${(await sessions.issueSessionForUser(entry)).session.rawToken}`;
}

async function membership(repository: PostgreSqlAuthRepository, sellerId: string, entry: AuthUser, role: AuthRole): Promise<void> {
  await repository.createSellerMembership({ sellerId, userId: entry.userId, role, status: "active" });
}

async function cleanup(): Promise<void> {
  if (sellers.length) {
    await executeDatabaseQuery({ text: "DELETE FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
    await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_memberships WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellers] });
  }
  if (users.length) await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [users] });
}

async function errorOf(callback: () => Promise<unknown>): Promise<unknown> {
  try { await callback(); return undefined; } catch (error) { return error; }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  await runDatabaseMigrations();
  const authRepository = new PostgreSqlAuthRepository();
  const sessions = new SessionAuthService(authRepository, new PasswordAuthService(authRepository));
  const catalog = new CatalogService(new PostgreSqlCatalogRepository());
  const connections = new PostgreSqlWhatsAppConnectionRepository();
  const profiles = new PostgreSqlSellerWorkspaceProfileRepository();
  const commerce = new SellerCommerceConfigRepository();
  const conversations = new ConversationConfigService(new PostgreSqlConversationConfigRepository());
  const app = express();
  app.use(express.json());
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError || (typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed")) {
      sendWhatsAppConnectionProductBindingValidationError(res, [{ field: "body", code: "INVALID_OBJECT" }]);
      return;
    }
    next(error);
  });
  app.use("/api/whatsapp-connections", createWhatsAppConnectionRoutes(createAuthComposition()));
  const { server, base } = await start(app);
  const prefix = id("d4b31b");

  try {
    const sellerA = id("seller_d4b31b_a");
    const sellerB = id("seller_d4b31b_b");
    sellers.push(sellerA, sellerB);
    const tenantA = createTenantContext(sellerA);
    const tenantB = createTenantContext(sellerB);
    await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerA) });
    await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerB) });
    await profiles.createProfile({ sellerId: sellerA, displayName: "Binding API Store" });
    await commerce.save(tenantA, commerceConfig(sellerA));
    await conversations.saveSellerOverride(tenantA, { schemaVersion: 1 });

    const owner = await user(authRepository, prefix, "owner");
    const admin = await user(authRepository, prefix, "admin");
    const agent = await user(authRepository, prefix, "agent");
    const viewer = await user(authRepository, prefix, "viewer");
    const ownerB = await user(authRepository, prefix, "owner_b");
    await membership(authRepository, sellerA, owner, "OWNER");
    await membership(authRepository, sellerA, admin, "ADMIN");
    await membership(authRepository, sellerA, agent, "AGENT");
    await membership(authRepository, sellerA, viewer, "VIEWER");
    await membership(authRepository, sellerB, ownerB, "OWNER");
    const ownerCookie = await cookie(sessions, owner);
    const adminCookie = await cookie(sessions, admin);
    const agentCookie = await cookie(sessions, agent);
    const viewerCookie = await cookie(sessions, viewer);
    const ownerBCookie = await cookie(sessions, ownerB);

    const availableId = id("available");
    const unavailableId = id("unavailable");
    const sharedId = id("shared");
    const foreignId = id("foreign");
    const deletedId = id("deleted");
    await catalog.createProduct(tenantA, product(availableId, "Available A"));
    await catalog.createProduct(tenantA, product(unavailableId, "Unavailable A", "unavailable"));
    await catalog.createProduct(tenantA, product(sharedId, "Shared A"));
    await catalog.createProduct(tenantA, product(deletedId, "Deleted A"));
    await catalog.createProduct(tenantB, product(sharedId, "Shared B"));
    await catalog.createProduct(tenantB, product(foreignId, "Foreign B"));

    const active = await connections.createCandidate(tenantA);
    await connections.persistVerifiedMetadata(tenantA, active.connectionId, { metaBusinessId: id("business"), wabaId: id("waba"), phoneNumberId: id("phone"), displayPhoneNumber: "+212600000001", verifiedName: "Binding API Store" });
    await connections.updateLifecycleStatus(tenantA, active.connectionId, "ACTIVE");
    const inactive = await connections.createCandidate(tenantA);
    const foreignConnection = await connections.createCandidate(tenantB);
    const endpoint = `/api/whatsapp-connections/${active.connectionId}/product-binding`;

    add("unauthenticated GET, PUT, and DELETE return 401", (await request(base, endpoint)).status === 401 && (await request(base, endpoint, { method: "PUT", body: { productId: availableId } })).status === 401 && (await request(base, endpoint, { method: "DELETE" })).status === 401);

    const initial = await request(base, endpoint, { cookie: ownerCookie });
    add("OWNER reads an unbound active connection with mapped readiness", initial.status === 200 && (initial.body.binding as { state?: string })?.state === "UNBOUND" && (initial.body.commerceReadiness as { evaluated?: boolean; ready?: boolean; reasonCode?: string })?.evaluated === true && (initial.body.commerceReadiness as { reasonCode?: string })?.reasonCode === "PRODUCT_UNBOUND");

    const boundAvailable = await request(base, endpoint, { method: "PUT", body: { productId: availableId }, cookie: ownerCookie });
    add("OWNER binds available product and receives safe ready summary", boundAvailable.status === 200 && (boundAvailable.body.binding as { state?: string; product?: { productId?: string; name?: string; availability?: string } })?.state === "BOUND_AVAILABLE" && (boundAvailable.body.binding as { product?: { productId?: string; name?: string; availability?: string } })?.product?.productId === availableId && (boundAvailable.body.commerceReadiness as { ready?: boolean; reasonCode?: string })?.ready === true && (boundAvailable.body.commerceReadiness as { reasonCode?: string })?.reasonCode === "READY");

    const boundUnavailable = await request(base, endpoint, { method: "PUT", body: { productId: unavailableId }, cookie: adminCookie });
    add("ADMIN binds unavailable product and readiness remains incomplete", boundUnavailable.status === 200 && (boundUnavailable.body.binding as { state?: string })?.state === "BOUND_UNAVAILABLE" && (boundUnavailable.body.commerceReadiness as { ready?: boolean; reasonCode?: string })?.ready === false && (boundUnavailable.body.commerceReadiness as { reasonCode?: string })?.reasonCode === "PRODUCT_UNAVAILABLE");

    const changed = await request(base, endpoint, { method: "PUT", body: { productId: availableId }, cookie: ownerCookie });
    const repeated = await request(base, endpoint, { method: "PUT", body: { productId: availableId }, cookie: ownerCookie });
    add("change and repeated bind are final-state safe", changed.status === 200 && repeated.status === 200 && (repeated.body.binding as { product?: { productId?: string } })?.product?.productId === availableId);

    add("AGENT and VIEWER may read but cannot mutate", (await request(base, endpoint, { cookie: agentCookie })).status === 200 && (await request(base, endpoint, { cookie: viewerCookie })).status === 200 && (await request(base, endpoint, { method: "PUT", body: { productId: availableId }, cookie: agentCookie })).status === 403 && (await request(base, endpoint, { method: "DELETE", cookie: viewerCookie })).status === 403);

    const foreignProduct = await request(base, endpoint, { method: "PUT", body: { productId: foreignId }, cookie: ownerCookie });
    const missingProduct = await request(base, endpoint, { method: "PUT", body: { productId: id("missing") }, cookie: ownerCookie });
    add("foreign and missing products are identical non-leaking 404s and preserve binding", foreignProduct.status === 404 && missingProduct.status === 404 && foreignProduct.text === missingProduct.text && (await request(base, endpoint, { cookie: ownerCookie })).body.binding !== null && ((await request(base, endpoint, { cookie: ownerCookie })).body.binding as { product?: { productId?: string } })?.product?.productId === availableId);

    const foreignEndpoint = `/api/whatsapp-connections/${foreignConnection.connectionId}/product-binding`;
    const missingConnection = await request(base, `/api/whatsapp-connections/${id("missing_connection")}/product-binding`, { cookie: ownerCookie });
    const foreignConnectionReply = await request(base, foreignEndpoint, { cookie: ownerCookie });
    add("foreign and missing connections are identical non-leaking 404s", missingConnection.status === 404 && foreignConnectionReply.status === 404 && missingConnection.text === foreignConnectionReply.text);

    const shared = await request(base, endpoint, { method: "PUT", body: { productId: sharedId }, cookie: ownerCookie });
    add("same product ID is resolved only in the authenticated tenant", shared.status === 200 && (shared.body.binding as { product?: { name?: string } })?.product?.name === "Shared A" && !shared.text.includes("Shared B"));

    const parserReplies = await Promise.all([
      request(base, endpoint, { method: "PUT", body: { productId: null }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: "  " }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: "x".repeat(129) }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: availableId, sellerId: sellerB }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: availableId, accessToken: "secret" }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: availableId, phoneNumberId: "attacker" }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: { id: availableId } }, cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", body: { productId: availableId, name: "attacker" }, cookie: ownerCookie }),
      request(base, `${endpoint}?sellerId=${sellerB}`, { cookie: ownerCookie }),
      request(base, endpoint, { rawBody: "{}", cookie: ownerCookie }),
      request(base, endpoint, { method: "DELETE", rawBody: "{}", cookie: ownerCookie }),
      request(base, endpoint, { method: "PUT", rawBody: "{", cookie: ownerCookie }),
    ]);
    add("strict parser rejects malformed, authority, credential, phone, object, query, and forbidden GET/DELETE bodies", parserReplies.every((reply) => reply.status === 400 && reply.body.message === "Invalid product binding request." && Array.isArray(reply.body.errors)));

    const cleared = await request(base, endpoint, { method: "DELETE", cookie: ownerCookie });
    const clearedAgain = await request(base, endpoint, { method: "DELETE", cookie: ownerCookie });
    add("clear and repeated clear preserve connection and return final unbound state", cleared.status === 200 && clearedAgain.status === 200 && (clearedAgain.body.binding as { state?: string })?.state === "UNBOUND" && (await connections.findByConnectionId(tenantA, active.connectionId))?.status === "ACTIVE");

    await request(base, endpoint, { method: "PUT", body: { productId: deletedId }, cookie: ownerCookie });
    await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = $1 AND product_id = $2", values: [sellerA, deletedId] });
    const afterProductDeletion = await request(base, endpoint, { cookie: ownerCookie });
    add("product deletion returns the persisted unbound state", afterProductDeletion.status === 200 && (afterProductDeletion.body.binding as { state?: string; product?: unknown })?.state === "UNBOUND" && (afterProductDeletion.body.binding as { product?: unknown })?.product === null);

    const inactiveEndpoint = `/api/whatsapp-connections/${inactive.connectionId}/product-binding`;
    const inactiveResponse = await request(base, inactiveEndpoint, { method: "PUT", body: { productId: availableId }, cookie: ownerCookie });
    add("non-active connection returns accurate binding but does not evaluate another connection readiness", inactiveResponse.status === 200 && (inactiveResponse.body.binding as { state?: string })?.state === "BOUND_AVAILABLE" && (inactiveResponse.body.commerceReadiness as { evaluated?: boolean; ready?: boolean; reasonCode?: string })?.evaluated === false && (inactiveResponse.body.commerceReadiness as { ready?: boolean })?.ready === false && (inactiveResponse.body.commerceReadiness as { reasonCode?: string })?.reasonCode === "CONNECTION_NOT_ACTIVE");

    const safetyText = JSON.stringify([boundAvailable.body, boundUnavailable.body, shared.body, missingConnection.body, foreignProduct.body]);
    add("responses expose neither tenant ownership nor credentials, Meta identifiers, SQL, or stack traces", !/sellerId|workspaceId|tenantId|membership|accessToken|encrypted|fingerprint|phoneNumberId|wabaId|webhook|constraint|sql|stack/i.test(safetyText));

    const existingProduct = (await catalog.getProduct(tenantA, availableId))!;
    let catalogReads = 0;
    const raceCatalog = new CatalogService({
      findProduct: async () => (++catalogReads === 1 ? existingProduct : null),
    } as never);
    const raceConnection = { ...(await connections.findByConnectionId(tenantA, active.connectionId))!, boundProductId: availableId };
    const raceRepository = {
      findByConnectionId: async () => raceConnection,
      setBoundProductId: async () => { throw new WhatsAppConnectionSellerNotFoundError(); },
    } as unknown as WhatsAppConnectionRepository;
    const raceError = await errorOf(() => new WhatsAppConnectionProductBindingService(raceRepository, raceCatalog).setBoundProductId(tenantA, active.connectionId, availableId));
    add("product FK deletion race is converted to bounded product-not-found authority", raceError instanceof ProductNotFoundError);

    add("foreign owner remains isolated", (await request(base, endpoint, { cookie: ownerBCookie })).status === 404);
  } finally {
    await stop(server);
    await cleanup();
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ phase: "D4-B3.1b", summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error: unknown) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ phase: "D4-B3.1b", ok: false, message: error instanceof Error ? error.message : "connection product-binding API test failed" })}\n`);
  process.exitCode = 1;
});
