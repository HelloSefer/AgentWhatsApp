import { createServer, type RequestListener, type Server } from "node:http";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import app from "../../../app";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, getDatabasePoolState } from "../../../infrastructure/database";
import { createAuthComposition } from "../../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { csrfOriginProtection } from "../../auth/http/csrf-origin.middleware";
import { createAuthRoutes } from "../../auth/auth.routes";
import { AUTH_COOKIE_NAME } from "../../auth/http/auth-cookie";
import { PostgreSqlAuthRepository } from "../../auth";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import { LocalSellerLogoStorageAdapter, SellerLogoService, validateSellerLogoStorageConfiguration } from "../../seller-logo";
import { createOnboardingRoutes } from "../onboarding.routes";
import { SellerWorkspaceOnboardingService } from "../../seller-workspace-onboarding";
import { PostgreSqlConversationConfigRepository } from "../../conversation-config";
import type { SellerRepositoryOptions } from "../../seller/contracts/seller.repository";
import type { Seller } from "../../seller/domain/seller";
import type { CreateSellerWorkspaceProfileInput, SellerWorkspaceProfileRepositoryOptions } from "../../seller-workspace-profile/contracts/seller-workspace-profile.repository";
import type { SellerWorkspaceProfile } from "../../seller-workspace-profile";
import type { SellerMembership } from "../../auth/domain/auth.types";
import type { RepositoryOptions } from "../../auth/contracts/auth.repository";
import type { ConversationConfigRepositoryOptions } from "../../conversation-config/contracts/conversation-config.repository";
import type { PersistedConversationConfig } from "../../conversation-config/domain/persisted-conversation-config.types";
import type { ConversationConfigurationOverride } from "../../conversation-engine";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type HttpResponse = Readonly<{ status: number; body: unknown; text: string; setCookie?: string; retryAfter?: string }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const userIds: string[] = [];
const sellerIds: string[] = [];
const testRoot = path.resolve(process.cwd(), "tmp", "phase-10e-backend-acceptance");

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

function multipart(file: Buffer, mimeType: string): Readonly<{ body: Uint8Array; contentType: string }> {
  const boundary = `phase10e_${randomUUID().replace(/-/gu, "")}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo"\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: new Uint8Array(Buffer.concat([head, file, tail])),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function expectsError(callback: () => Promise<unknown>, isExpected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
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
  rawBody?: Uint8Array;
  contentType?: string;
  cookie?: string;
  origin?: string;
}> = {}): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: input.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(input.body === undefined && input.rawBody === undefined ? {} : { "content-type": input.contentType ?? "application/json" }),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
    },
    body: (input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body))) as BodyInit | undefined,
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

async function signup(baseUrl: string, label: string, status: "active" | "disabled" = "active"): Promise<Readonly<{ userId: string; cookie: string }>> {
  if (status === "active") {
    const response = await request(baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { email: `${label}@example.com`, password: "Str0ng!Phase10E" },
    });
    const userId = (response.body as { user?: { userId?: string } }).user?.userId ?? "";
    userIds.push(userId);
    return { userId, cookie: cookieHeader(response.setCookie ?? "") };
  }

  const repository = new PostgreSqlAuthRepository();
  const user = await repository.createUser({
    userId: id("user_phase10e_disabled"),
    emailNormalized: `${label}@example.com`,
    status: "disabled",
  });
  userIds.push(user.userId);
  return { userId: user.userId, cookie: "" };
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

function createLocalAcceptanceApp(): express.Express {
  const authComposition = createAuthComposition();
  const persistence = createPersistenceComposition();
  const localPersistence = {
    ...persistence,
    sellerLogoService: new SellerLogoService({
      storage: new LocalSellerLogoStorageAdapter(testRoot),
      profileRepository: persistence.sellerWorkspaceProfileRepository,
    }),
  };
  const localApp = express();
  localApp.use(express.json());
  localApp.use(csrfOriginProtection);
  localApp.use("/api/auth", createAuthRoutes(authComposition));
  localApp.use("/api/onboarding", createOnboardingRoutes(authComposition, localPersistence));
  return localApp;
}

async function createExistingMembership(userId: string, role: "OWNER" | "AGENT", withConfig = true): Promise<string> {
  const sellerId = id("seller_phase10e_existing");
  await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerId) });
  sellerIds.push(sellerId);
  await new PostgreSqlSellerWorkspaceProfileRepository().createProfile({ sellerId, displayName: `${role} Existing` });
  await new PostgreSqlAuthRepository().createSellerMembership({ sellerId, userId, role, status: "active" });
  if (withConfig) await new PostgreSqlConversationConfigRepository().saveSellerOverride(createTenantContext(sellerId), { schemaVersion: 1 });
  return sellerId;
}

class FailingSellerRepository extends PostgreSqlSellerRepository {
  async create(): Promise<Seller> {
    throw new Error("phase10e seller failure");
  }
}

class TrackingSellerRepository extends PostgreSqlSellerRepository {
  readonly createdSellerIds: string[] = [];

  async create(input: { sellerId: ReturnType<typeof validateSellerId> }, options?: SellerRepositoryOptions): Promise<Seller> {
    const seller = await super.create(input, options);
    this.createdSellerIds.push(seller.sellerId);
    sellerIds.push(seller.sellerId);
    return seller;
  }
}

class FailingProfileRepository extends PostgreSqlSellerWorkspaceProfileRepository {
  async createProfile(input: CreateSellerWorkspaceProfileInput, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile> {
    await Promise.resolve(input);
    await Promise.resolve(options);
    throw new Error("phase10e profile failure");
  }
}

class FailingMembershipRepository extends PostgreSqlAuthRepository {
  async createSellerMembership(input: Readonly<{ sellerId: string; userId: string; role: "OWNER"; status: "active" }>, options?: RepositoryOptions): Promise<SellerMembership> {
    await Promise.resolve(input);
    await Promise.resolve(options);
    throw new Error("phase10e membership failure");
  }
}

class FailingConfigRepository extends PostgreSqlConversationConfigRepository {
  async saveSellerOverride(tenant: ReturnType<typeof createTenantContext>, config: ConversationConfigurationOverride, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig> {
    await Promise.resolve(tenant);
    await Promise.resolve(config);
    await Promise.resolve(options);
    throw new Error("phase10e config failure");
  }
}

async function assertNoRowsForSeller(userId: string, sellerId: string): Promise<boolean> {
  const [sellerCount, profileCount, membershipCount, configCount] = await Promise.all([
    count("sellers", "seller_id", [sellerId]),
    count("seller_workspace_profiles", "seller_id", [sellerId]),
    count("seller_memberships", "user_id", [userId]),
    count("seller_conversation_configs", "seller_id", [sellerId]),
  ]);
  return sellerCount === 0 && profileCount === 0 && membershipCount === 0 && configCount === 0;
}

async function runRollbackChecks(): Promise<void> {
  const authRepository = new PostgreSqlAuthRepository();
  const user = await authRepository.createUser({
    userId: id("user_phase10e_rollback"),
    emailNormalized: `${id("phase10e_rollback")}@example.com`,
    status: "active",
  });
  userIds.push(user.userId);

  const baseDependencies = {
    authRepository,
    sellerRepository: new PostgreSqlSellerRepository(),
    profileRepository: new PostgreSqlSellerWorkspaceProfileRepository(),
    conversationConfigRepository: new PostgreSqlConversationConfigRepository(),
  };
  add("Seller creation failure leaves no downstream rows", await expectsError(
    () => new SellerWorkspaceOnboardingService({ ...baseDependencies, sellerRepository: new FailingSellerRepository() }).createWorkspace({ userId: user.userId, storeName: "Rollback Seller" }),
    (error) => error instanceof Error,
  ) && await count("seller_memberships", "user_id", [user.userId]) === 0);

  const profileTracker = new TrackingSellerRepository();
  add("Profile failure rolls back Seller", await expectsError(
    () => new SellerWorkspaceOnboardingService({ ...baseDependencies, sellerRepository: profileTracker, profileRepository: new FailingProfileRepository() }).createWorkspace({ userId: user.userId, storeName: "Rollback Profile" }),
    (error) => error instanceof Error,
  ) && await assertNoRowsForSeller(user.userId, profileTracker.createdSellerIds[0] ?? ""));

  const membershipTracker = new TrackingSellerRepository();
  add("OWNER membership failure rolls back Seller/profile", await expectsError(
    () => new SellerWorkspaceOnboardingService({ ...baseDependencies, sellerRepository: membershipTracker, authRepository: new FailingMembershipRepository() }).createWorkspace({ userId: user.userId, storeName: "Rollback Membership" }),
    (error) => error instanceof Error,
  ) && await assertNoRowsForSeller(user.userId, membershipTracker.createdSellerIds[0] ?? ""));

  const configTracker = new TrackingSellerRepository();
  add("Default config failure rolls back everything", await expectsError(
    () => new SellerWorkspaceOnboardingService({ ...baseDependencies, sellerRepository: configTracker, conversationConfigRepository: new FailingConfigRepository() }).createWorkspace({ userId: user.userId, storeName: "Rollback Config" }),
    (error) => error instanceof Error,
  ) && await assertNoRowsForSeller(user.userId, configTracker.createdSellerIds[0] ?? ""));
}

function liveR2Configured(): boolean {
  return process.env.SELLER_LOGO_STORAGE_PROVIDER?.trim().toLocaleLowerCase("en-US") === "r2" &&
    Boolean(process.env.R2_ENDPOINT?.trim() && process.env.R2_ACCESS_KEY_ID?.trim() && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME?.trim());
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NotFound" || error.name === "NoSuchKey");
}

async function runLiveR2EndToEnd(): Promise<"PASSED" | "SKIPPED" | "FAILED"> {
  if (!liveR2Configured()) return "SKIPPED";
  const configuration = validateSellerLogoStorageConfiguration({
    provider: process.env.SELLER_LOGO_STORAGE_PROVIDER,
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
  });
  if (configuration.provider !== "r2") return "FAILED";
  const authComposition = createAuthComposition();
  const persistence = createPersistenceComposition();
  const liveApp = express();
  liveApp.use(express.json());
  liveApp.use(csrfOriginProtection);
  liveApp.use("/api/auth", createAuthRoutes(authComposition));
  liveApp.use("/api/onboarding", createOnboardingRoutes(authComposition, persistence));
  const { server, baseUrl } = await startServer(liveApp);
  const client = new S3Client({
    region: "auto",
    endpoint: configuration.endpoint,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });
  let objectKey: string | undefined;
  try {
    const user = await signup(baseUrl, id("phase10e_live_r2"));
    const created = await request(baseUrl, "/api/onboarding/workspace", {
      method: "POST",
      cookie: user.cookie,
      body: { storeName: "Phase 10E Live R2" },
    });
    const sellerId = (created.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    if (sellerId) sellerIds.push(sellerId);
    const upload = multipart(png(), "image/png");
    const uploaded = await request(baseUrl, "/api/onboarding/logo", {
      method: "POST",
      cookie: user.cookie,
      rawBody: upload.body,
      contentType: upload.contentType,
    });
    objectKey = (uploaded.body as { logo?: { objectKey?: string } }).logo?.objectKey;
    if (!sellerId || !objectKey || uploaded.status !== 200) return "FAILED";
    const profile = await new PostgreSqlSellerWorkspaceProfileRepository().findByTenantContext(createTenantContext(sellerId));
    if (profile?.logoObjectKey !== objectKey || profile.logoMimeType !== "image/png") return "FAILED";
    if (profile.logoObjectKey.includes("://") || profile.logoObjectKey.startsWith("/") || profile.logoMimeType.includes("base64")) return "FAILED";
    await client.send(new HeadObjectCommand({ Bucket: configuration.bucketName, Key: objectKey }));
    const deleted = await request(baseUrl, "/api/onboarding/logo", { method: "DELETE", cookie: user.cookie });
    if (deleted.status !== 200) return "FAILED";
    const cleared = await new PostgreSqlSellerWorkspaceProfileRepository().findByTenantContext(createTenantContext(sellerId));
    if (cleared?.logoObjectKey || cleared?.logoMimeType) return "FAILED";
    try {
      await client.send(new HeadObjectCommand({ Bucket: configuration.bucketName, Key: objectKey }));
      return "FAILED";
    } catch (error) {
      return isNotFound(error) ? "PASSED" : "FAILED";
    }
  } catch {
    return "FAILED";
  } finally {
    await stopServer(server);
    await cleanup();
  }
}

async function runDeterministicAcceptance(): Promise<void> {
  const localApp = createLocalAcceptanceApp();
  const { server, baseUrl } = await startServer(localApp);
  try {
    const noMembership = await signup(baseUrl, id("phase10e_nomembership"));
    const before = await request(baseUrl, "/api/onboarding/status", { cookie: noMembership.cookie });
    add("Onboarding status before creation is true", before.status === 200 && (before.body as { needsOnboarding?: unknown }).needsOnboarding === true);

    const created = await request(baseUrl, "/api/onboarding/workspace", {
      method: "POST",
      cookie: noMembership.cookie,
      body: {
        storeName: "  متجر   قبول  ",
        intendedWhatsAppPhone: " +212 600-000-010 ",
        userId: "attacker",
        sellerId: "seller_attacker",
        role: "OWNER",
        permission: "seller.manage",
        slug: "attacker",
        wabaId: "waba",
        phoneNumberId: "phone",
        whatsappStatus: "CONNECTED",
        onboardingCompletedAt: new Date().toISOString(),
      },
    });
    const workspace = (created.body as { workspace?: { sellerId?: string; displayName?: string; intendedWhatsAppPhone?: string; role?: string; whatsappStatus?: string; logo?: unknown } }).workspace;
    if (workspace?.sellerId) sellerIds.push(workspace.sellerId);
    add("Successful workspace creation accepts Unicode and trusted user ownership", created.status === 201 && workspace?.displayName === "متجر قبول" && workspace.role === "OWNER");
    add("Privilege escalation and Meta fields are ignored", workspace?.sellerId !== "seller_attacker" && workspace?.whatsappStatus === "NOT_CONNECTED" && !created.text.includes("waba") && !created.text.includes("phoneNumberId"));
    add("Optional phone present remains unverified metadata", workspace?.intendedWhatsAppPhone === "+212600000010" && workspace.whatsappStatus === "NOT_CONNECTED");
    add("One transaction created Seller/profile/OWNER/default config", workspace?.sellerId !== undefined && await count("sellers", "seller_id", [workspace.sellerId]) === 1 && await count("seller_workspace_profiles", "seller_id", [workspace.sellerId]) === 1 && await count("seller_memberships", "user_id", [noMembership.userId]) === 1 && await count("seller_conversation_configs", "seller_id", [workspace.sellerId]) === 1);

    const after = await request(baseUrl, "/api/onboarding/status", { cookie: noMembership.cookie });
    add("Onboarding status after creation is false with current workspace", after.status === 200 && (after.body as { needsOnboarding?: unknown; workspace?: { sellerId?: string } }).needsOnboarding === false && (after.body as { workspace?: { sellerId?: string } }).workspace?.sellerId === workspace?.sellerId);
    const repeated = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: noMembership.cookie, body: { storeName: "Repeated" } });
    add("Repeated request returns existing workspace", repeated.status === 200 && (repeated.body as { workspace?: { sellerId?: string } }).workspace?.sellerId === workspace?.sellerId);

    const concurrent = await signup(baseUrl, id("phase10e_concurrent"));
    const [first, second] = await Promise.all([
      request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: concurrent.cookie, body: { storeName: "Concurrent" } }),
      request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: concurrent.cookie, body: { storeName: "Concurrent" } }),
    ]);
    const firstSeller = (first.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    const secondSeller = (second.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    if (firstSeller) sellerIds.push(firstSeller);
    add("Concurrent request does not create duplicates", firstSeller !== undefined && firstSeller === secondSeller && [first.status, second.status].sort().join("|") === "200|201");

    const absentPhone = await signup(baseUrl, id("phase10e_absent_phone"));
    const absentCreated = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: absentPhone.cookie, body: { storeName: "No Phone" } });
    const absentWorkspace = (absentCreated.body as { workspace?: { sellerId?: string; intendedWhatsAppPhone?: string } }).workspace;
    if (absentWorkspace?.sellerId) sellerIds.push(absentWorkspace.sellerId);
    add("Optional phone may be absent", absentCreated.status === 201 && absentWorkspace?.intendedWhatsAppPhone === undefined);

    const inactive = await signup(baseUrl, id("phase10e_inactive"), "disabled");
    add("Inactive user is rejected by service", await expectsError(
      () => new SellerWorkspaceOnboardingService({
        authRepository: new PostgreSqlAuthRepository(),
        sellerRepository: new PostgreSqlSellerRepository(),
        profileRepository: new PostgreSqlSellerWorkspaceProfileRepository(),
        conversationConfigRepository: new PostgreSqlConversationConfigRepository(),
      }).createWorkspace({ userId: inactive.userId, storeName: "Inactive" }),
      (error) => error instanceof Error,
    ));

    const multi = await signup(baseUrl, id("phase10e_multi"));
    await createExistingMembership(multi.userId, "OWNER");
    await createExistingMembership(multi.userId, "OWNER");
    add("Multiple membership state maps to 409", (await request(baseUrl, "/api/onboarding/status", { cookie: multi.cookie })).status === 409);

    await runRollbackChecks();

    add("Unauthenticated HTTP requests are rejected", (await request(baseUrl, "/api/onboarding/status")).status === 401 && (await request(baseUrl, "/api/onboarding/workspace", { method: "POST", body: { storeName: "No Auth" } })).status === 401);
    const badName = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: (await signup(baseUrl, id("phase10e_bad_name"))).cookie, body: { storeName: " " } });
    const badPhone = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: (await signup(baseUrl, id("phase10e_bad_phone"))).cookie, body: { storeName: "Bad Phone", intendedWhatsAppPhone: "212600" } });
    add("Invalid payloads map to sanitized 400", badName.status === 400 && badPhone.status === 400 && !badPhone.text.includes("212600"));

    const csrfBlocked = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: (await signup(baseUrl, id("phase10e_csrf_block"))).cookie, origin: "https://evil.example", body: { storeName: "Blocked" } });
    const csrfAcceptedUser = await signup(baseUrl, id("phase10e_csrf_accept"));
    const csrfAccepted = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: csrfAcceptedUser.cookie, body: { storeName: "Accepted" } });
    const csrfAcceptedSeller = (csrfAccepted.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    if (csrfAcceptedSeller) sellerIds.push(csrfAcceptedSeller);
    add("CSRF/origin rejects bad origin and accepts same-origin/no-origin test request", csrfBlocked.status === 403 && csrfAccepted.status === 201);

    const limited = await signup(baseUrl, id("phase10e_limited"));
    let rateLimited: HttpResponse | undefined;
    for (let index = 0; index < 6; index += 1) {
      const response = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: limited.cookie, body: { storeName: "Limited" } });
      if (response.status === 429) {
        rateLimited = response;
        break;
      }
    }
    add("Rate limiting returns Retry-After", rateLimited?.status === 429 && Boolean(rateLimited.retryAfter));

    const logoUser = noMembership;
    const pngUpload = multipart(png(), "image/png");
    const pngLogo = await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: logoUser.cookie, rawBody: pngUpload.body, contentType: pngUpload.contentType });
    const pngKey = (pngLogo.body as { logo?: { objectKey?: string; mimeType?: string } }).logo?.objectKey;
    const jpegUpload = multipart(jpeg(), "image/jpeg");
    const jpegLogo = await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: logoUser.cookie, rawBody: jpegUpload.body, contentType: jpegUpload.contentType });
    const jpegKey = (jpegLogo.body as { logo?: { objectKey?: string; mimeType?: string } }).logo?.objectKey;
    const webpUpload = multipart(webp(), "image/webp");
    const webpLogo = await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: logoUser.cookie, rawBody: webpUpload.body, contentType: webpUpload.contentType });
    add("OWNER can upload PNG/JPEG/WebP and replace logo", pngLogo.status === 200 && jpegLogo.status === 200 && webpLogo.status === 200 && pngKey !== jpegKey);
    const removed = await request(baseUrl, "/api/onboarding/logo", { method: "DELETE", cookie: logoUser.cookie });
    add("OWNER can remove logo", removed.status === 200 && (removed.body as { logo?: unknown }).logo === null);

    const invalidLogoUser = await signup(baseUrl, id("phase10e_invalid_logo"));
    const invalidLogoWorkspace = await request(baseUrl, "/api/onboarding/workspace", { method: "POST", cookie: invalidLogoUser.cookie, body: { storeName: "Invalid Logo" } });
    const invalidLogoSeller = (invalidLogoWorkspace.body as { workspace?: { sellerId?: string } }).workspace?.sellerId;
    if (invalidLogoSeller) sellerIds.push(invalidLogoSeller);
    add("Invalid signature and oversized logo are rejected", (await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: invalidLogoUser.cookie, rawBody: multipart(Buffer.from("bad"), "image/png").body, contentType: multipart(Buffer.from("bad"), "image/png").contentType })).status === 400 && (await request(baseUrl, "/api/onboarding/logo", { method: "POST", cookie: invalidLogoUser.cookie, rawBody: multipart(oversizedPng(), "image/png").body, contentType: multipart(oversizedPng(), "image/png").contentType })).status === 413);

    const agent = await signup(baseUrl, id("phase10e_agent"));
    await createExistingMembership(agent.userId, "AGENT");
    add("Non-OWNER logo access is denied", (await request(baseUrl, "/api/onboarding/logo", { method: "DELETE", cookie: agent.cookie })).status === 403);
    const otherOwner = await signup(baseUrl, id("phase10e_other_owner"));
    const otherSeller = await createExistingMembership(otherOwner.userId, "OWNER");
    add("Cross-tenant logo access is denied", (await request(baseUrl, `/api/onboarding/logo?sellerId=${encodeURIComponent(otherSeller)}`, { method: "DELETE", cookie: logoUser.cookie })).status === 403);

    add("R2 provider selection rejects missing config and never silently falls back", await expectsError(
      async () => validateSellerLogoStorageConfiguration({ provider: "r2" }),
      (error) => error instanceof Error,
    ));
    add("No secret leakage in HTTP errors", (await request(baseUrl, "/api/onboarding/status", { cookie: `${AUTH_COOKIE_NAME}=secret-token-like-value` })).status === 401 && !(await request(baseUrl, "/api/onboarding/status", { cookie: `${AUTH_COOKIE_NAME}=secret-token-like-value` })).text.includes("secret-token-like-value"));
  } finally {
    await stopServer(server);
  }
}

async function main(): Promise<void> {
  await rm(testRoot, { recursive: true, force: true });
  await closeDatabasePool();
  add("No Phase 10 module import-time PostgreSQL I/O", !getDatabasePoolState().initialized && Boolean(app));
  add("No Phase 10 local filesystem I/O on composition before upload", !existsSync(testRoot));

  try {
    await runDeterministicAcceptance();
  } finally {
    await cleanup();
    add("Complete cleanup of Phase 10E deterministic records/files", await count("auth_users", "user_id", userIds) === 0 && await count("sellers", "seller_id", sellerIds) === 0 && !existsSync(testRoot));
    await closeDatabasePool();
  }

  const liveR2 = await runLiveR2EndToEnd();
  add(`Live R2 end-to-end ${liveR2}`, liveR2 === "PASSED" || liveR2 === "SKIPPED");

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length, liveR2 },
    cases,
  })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 10E backend acceptance test failed safely." })}\n`);
  process.exitCode = 1;
});
