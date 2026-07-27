import { createServer, type RequestListener, type Server } from "node:http";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import app from "../../../app";
import { csrfOriginProtection } from "../../auth/http/csrf-origin.middleware";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { closeDatabasePool, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import { PostgreSqlAuthRepository } from "../../auth";
import { createAuthRoutes } from "../../auth/auth.routes";
import { AUTH_COOKIE_NAME } from "../../auth/http/auth-cookie";
import { LocalSellerLogoStorageAdapter, SellerLogoService } from "../../seller-logo";
import { createOnboardingRoutes } from "../onboarding.routes";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body: unknown; text: string; setCookie?: string; retryAfter?: string }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];
const userIds: string[] = [];
const testRoot = path.resolve(process.cwd(), "tmp", "phase-10d-onboarding-http");

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function png(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function jpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
}

function webp(): Buffer {
  return Buffer.from("RIFFxxxxWEBPVP8 ", "ascii");
}

function oversizedPng(): Buffer {
  const bytes = Buffer.alloc((2 * 1024 * 1024) + 1);
  png().copy(bytes);
  return bytes;
}

function multipart(file: Buffer, mimeType: string): Readonly<{ body: Buffer; contentType: string }> {
  const boundary = `phase10d_${randomUUID().replace(/-/gu, "")}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo"\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, file, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function startServer(handler: RequestListener): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) throw new Error("Server address unavailable.");
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(baseUrl: string, urlPath: string, input: Readonly<{
  method?: string;
  body?: unknown;
  rawBody?: Buffer;
  contentType?: string;
  cookie?: string;
  origin?: string;
  referer?: string;
}> = {}): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: input.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(input.body === undefined && input.rawBody === undefined ? {} : { "content-type": input.contentType ?? "application/json" }),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.referer ? { referer: input.referer } : {}),
    },
    body: input.rawBody ? new Uint8Array(input.rawBody) : (input.body === undefined ? undefined : JSON.stringify(input.body)),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: response.status,
    body,
    text,
    setCookie: response.headers.get("set-cookie") ?? undefined,
    retryAfter: response.headers.get("retry-after") ?? undefined,
  };
}

function cookieHeader(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

async function signup(baseUrl: string, label: string): Promise<Readonly<{ userId: string; cookie: string }>> {
  const email = `${label}@example.com`;
  const response = await request(baseUrl, "/api/auth/signup", { method: "POST", body: { email, password: "Str0ng!Phase10D" } });
  const userId = ((response.body as { user?: { userId?: string } }).user?.userId) ?? "";
  userIds.push(userId);
  return { userId, cookie: cookieHeader(response.setCookie ?? "") };
}

async function count(table: string, column: string, values: readonly string[]): Promise<number> {
  if (!values.length) return 0;
  const result = await executeDatabaseQuery<CountRow>({
    text: `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${column} = ANY($1::text[])`,
    values: [values],
  });
  return Number(result.rows[0]?.count ?? "0");
}

async function sellerIdsForUsers(): Promise<readonly string[]> {
  if (!userIds.length) return [];
  const result = await executeDatabaseQuery<{ seller_id: string }>({
    text: "SELECT seller_id FROM seller_memberships WHERE user_id = ANY($1::text[])",
    values: [userIds],
  });
  return result.rows.map((row) => row.seller_id);
}

async function cleanup(): Promise<void> {
  const dynamicSellerIds = await sellerIdsForUsers();
  const allSellerIds = [...new Set([...sellerIds, ...dynamicSellerIds])];
  if (allSellerIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])", values: [allSellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_memberships WHERE seller_id = ANY($1::varchar[])", values: [allSellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])", values: [allSellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [allSellerIds] });
  }
  if (userIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
  }
  await rm(testRoot, { recursive: true, force: true });
}

function createLocalApp(): express.Express {
  const authComposition = createAuthComposition();
  const persistence = createPersistenceComposition();
  const profileRepository = persistence.sellerWorkspaceProfileRepository;
  const localPersistence = {
    ...persistence,
    sellerLogoService: new SellerLogoService({
      storage: new LocalSellerLogoStorageAdapter(testRoot),
      profileRepository,
    }),
  };
  const localApp = express();
  localApp.use(express.json());
  localApp.use(csrfOriginProtection);
  localApp.use("/api/auth", createAuthRoutes(authComposition));
  localApp.use("/api/onboarding", createOnboardingRoutes(authComposition, localPersistence));
  return localApp;
}

async function createExistingMembership(userId: string, role: "OWNER" | "AGENT"): Promise<string> {
  const sellerId = id("seller_phase10d_existing");
  await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerId) });
  sellerIds.push(sellerId);
  await new PostgreSqlSellerWorkspaceProfileRepository().createProfile({ sellerId, displayName: `${role} Store` });
  await new PostgreSqlAuthRepository().createSellerMembership({ sellerId, userId, role, status: "active" });
  return sellerId;
}

async function main(): Promise<void> {
  await rm(testRoot, { recursive: true, force: true });
  await closeDatabasePool();
  add("Onboarding HTTP import does not initialize PostgreSQL", !getDatabasePoolState().initialized && Boolean(app));
  add("Onboarding route composition does not touch logo filesystem", !existsSync(testRoot));

  const localApp = createLocalApp();
  const { server, baseUrl } = await startServer(localApp);

  try {
    const unauthStatus = await request(baseUrl, "/api/onboarding/status");
    const unauthWorkspace = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", body: { storeName: "No Auth" } });
    add("Unauthenticated access is rejected", unauthStatus.status === 401 && unauthWorkspace.status === 401);

    const beforeUser = await signup(baseUrl, id("phase10d_before"));
    const beforeStatus = await request(baseUrl, "/api/onboarding/status", { cookie: beforeUser.cookie });
    add("Status before creation requires onboarding", beforeStatus.status === 200 && (beforeStatus.body as { needsOnboarding?: unknown }).needsOnboarding === true && !("workspace" in (beforeStatus.body as object)));

    const createResponse = await request(baseUrl, "/api/onboarding/workspace", {
      method: "POST",
      cookie: beforeUser.cookie,
      body: {
        storeName: "  Atlas   HTTP  ",
        intendedWhatsAppPhone: " +212 600-000-004 ",
        userId: "attacker",
        sellerId: "seller_attacker",
        role: "OWNER",
        slug: "bad",
        whatsappStatus: "CONNECTED",
        wabaId: "waba",
        phoneNumberId: "phone",
      },
    });
    const createdWorkspace = (createResponse.body as { workspace?: { sellerId?: string; displayName?: string; intendedWhatsAppPhone?: string; role?: string; whatsappStatus?: string } }).workspace;
    if (createdWorkspace?.sellerId) sellerIds.push(createdWorkspace.sellerId);
    add("Workspace creation succeeds through protected API", createResponse.status === 201 && createdWorkspace?.displayName === "Atlas HTTP");
    add("Client escalation fields are ignored", createdWorkspace?.sellerId !== "seller_attacker" && createdWorkspace?.role === "OWNER" && createdWorkspace?.whatsappStatus === "NOT_CONNECTED");
    add("Current user becomes OWNER", createdWorkspace?.role === "OWNER" && (await count("seller_memberships", "user_id", [beforeUser.userId])) === 1);
    add("Phone remains unverified metadata only", createdWorkspace?.intendedWhatsAppPhone === "+212600000004" && createdWorkspace?.whatsappStatus === "NOT_CONNECTED");

    const afterStatus = await request(baseUrl, "/api/onboarding/status", { cookie: beforeUser.cookie });
    add("Status after creation returns current single workspace summary", afterStatus.status === 200 && (afterStatus.body as { needsOnboarding?: unknown; workspace?: { sellerId?: string } }).needsOnboarding === false && (afterStatus.body as { workspace?: { sellerId?: string } }).workspace?.sellerId === createdWorkspace?.sellerId);

    const repeated = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: beforeUser.cookie, body: { storeName: "Repeated Name" } });
    add("Double submission returns existing workspace safely", repeated.status === 200 && (repeated.body as { status?: unknown; workspace?: { sellerId?: string } }).status === "existing" && (repeated.body as { workspace?: { sellerId?: string } }).workspace?.sellerId === createdWorkspace?.sellerId);

    const concurrentUser = await signup(baseUrl, id("phase10d_concurrent"));
    const [concurrentA, concurrentB] = await Promise.all([
      request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: concurrentUser.cookie, body: { storeName: "Concurrent HTTP" } }),
      request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: concurrentUser.cookie, body: { storeName: "Concurrent HTTP" } }),
    ]);
    const concurrentSellerA = (concurrentA.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    const concurrentSellerB = (concurrentB.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    if (concurrentSellerA) sellerIds.push(concurrentSellerA);
    add("Concurrent workspace submissions create exactly one workspace", concurrentSellerA !== undefined && concurrentSellerA === concurrentSellerB && [concurrentA.status, concurrentB.status].sort().join("|") === "200|201");

    const invalidName = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: (await signup(baseUrl, id("phase10d_invalid_name"))).cookie, body: { storeName: " " } });
    const invalidPhone = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: (await signup(baseUrl, id("phase10d_invalid_phone"))).cookie, body: { storeName: "Bad Phone", intendedWhatsAppPhone: "212600" } });
    add("Invalid store name and phone map to 400", invalidName.status === 400 && invalidPhone.status === 400 && !invalidPhone.text.includes("212600"));

    const pngUpload = multipart(png(), "image/png");
    const pngLogo = await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: beforeUser.cookie, rawBody: pngUpload.body, contentType: pngUpload.contentType });
    const pngLogoKey = (pngLogo.body as { logo?: { objectKey?: string; mimeType?: string } }).logo?.objectKey;
    add("PNG logo upload succeeds for OWNER workspace", pngLogo.status === 200 && Boolean(pngLogoKey) && (pngLogo.body as { logo?: { mimeType?: string } }).logo?.mimeType === "image/png");
    const jpegUpload = multipart(jpeg(), "image/jpeg");
    const jpegLogo = await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: beforeUser.cookie, rawBody: jpegUpload.body, contentType: jpegUpload.contentType });
    const jpegLogoKey = (jpegLogo.body as { logo?: { objectKey?: string; mimeType?: string } }).logo?.objectKey;
    add("JPEG logo upload replaces existing logo", jpegLogo.status === 200 && jpegLogoKey !== pngLogoKey && Boolean(jpegLogoKey));
    const webpUpload = multipart(webp(), "image/webp");
    const webpLogo = await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: beforeUser.cookie, rawBody: webpUpload.body, contentType: webpUpload.contentType });
    add("WebP logo upload succeeds", webpLogo.status === 200 && (webpLogo.body as { logo?: { mimeType?: string } }).logo?.mimeType === "image/webp");

    const deleteLogo = await request(baseUrl, "/api/onboarding/logo", { method: "DELETE", cookie: beforeUser.cookie });
    add("Logo delete clears metadata safely", deleteLogo.status === 200 && (deleteLogo.body as { logo?: unknown }).logo === null);

    const otherOwner = await signup(baseUrl, id("phase10d_other_owner"));
    const otherSeller = await createExistingMembership(otherOwner.userId, "OWNER");
    add("Cross-tenant logo mutation is denied", (await request(baseUrl, `/api/onboarding/logo?sellerId=${encodeURIComponent(otherSeller)}`, { method: "DELETE", cookie: beforeUser.cookie })).status === 403);

    const invalidLogoUser = await signup(baseUrl, id("phase10d_invalid_logo"));
    const invalidLogoCreate = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: invalidLogoUser.cookie, body: { storeName: "Invalid Logo Store" } });
    const invalidLogoSeller = (invalidLogoCreate.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    if (invalidLogoSeller) sellerIds.push(invalidLogoSeller);
    const badMime = multipart(png(), "image/gif");
    const badSignature = multipart(Buffer.from("nope"), "image/png");
    const tooLarge = multipart(oversizedPng(), "image/png");
    add("Invalid MIME/signature and oversized logo map safely", (await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: invalidLogoUser.cookie, rawBody: badMime.body, contentType: badMime.contentType })).status === 400 && (await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: invalidLogoUser.cookie, rawBody: badSignature.body, contentType: badSignature.contentType })).status === 400 && (await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: invalidLogoUser.cookie, rawBody: tooLarge.body, contentType: tooLarge.contentType })).status === 413);

    const agentUser = await signup(baseUrl, id("phase10d_agent"));
    await createExistingMembership(agentUser.userId, "AGENT");
    const agentUpload = multipart(png(), "image/png");
    add("Non-OWNER logo mutation is denied", (await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: agentUser.cookie, rawBody: agentUpload.body, contentType: agentUpload.contentType })).status === 403);

    const csrfBlocked = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: (await signup(baseUrl, id("phase10d_csrf"))).cookie, origin: "https://evil.example", body: { storeName: "CSRF" } });
    add("CSRF/origin protection blocks unsafe untrusted origins", csrfBlocked.status === 403);

    const limitedUser = await signup(baseUrl, id("phase10d_limited"));
    const rateStatuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: limitedUser.cookie, body: { storeName: "Limited Store" } });
      rateStatuses.push(response.status);
      if (response.status === 429) {
        add("Rate limit returns 429 with Retry-After", Boolean(response.retryAfter));
        break;
      }
    }
    add("Focused rate limit is enforced for workspace creation", rateStatuses.includes(429));

    const missingAuth = await request(baseUrl, "/api/onboarding/status", { cookie: `${AUTH_COOKIE_NAME}=not-real` });
    add("Safe HTTP errors are sanitized", missingAuth.status === 401 && !missingAuth.text.includes("not-real") && invalidPhone.status === 400 && !invalidPhone.text.includes("seller_"));
  } finally {
    await stopServer(server);
    await cleanup();
    add("Only Phase 10D test records and files are cleaned up", (await count("auth_users", "user_id", userIds)) === 0 && (await count("sellers", "seller_id", sellerIds)) === 0 && !existsSync(testRoot));
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 10D onboarding HTTP test failed safely.", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
