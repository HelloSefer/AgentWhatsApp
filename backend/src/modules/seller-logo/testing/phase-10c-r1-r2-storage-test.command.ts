import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabasePoolState,
} from "../../../infrastructure/database";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import type { CreateSellerWorkspaceProfileInput, SellerWorkspaceProfileRepositoryOptions } from "../../seller-workspace-profile/contracts/seller-workspace-profile.repository";
import type { SellerWorkspaceLogoMetadata, SellerWorkspaceProfile } from "../../seller-workspace-profile/domain/seller-workspace-profile.types";
import { SellerLogoService } from "../application/seller-logo.service";
import { SellerLogoStorageConfigurationError } from "../domain/seller-logo-configuration.errors";
import { SellerLogoStorageError, SellerLogoValidationError } from "../domain/seller-logo.errors";
import type { SellerLogoMetadata } from "../domain/seller-logo.types";
import { createSellerLogoObjectKey } from "../domain/seller-logo.validation";
import { createSellerLogoStorageFromConfiguration } from "../infrastructure/create-seller-logo-storage";
import { LocalSellerLogoStorageAdapter } from "../infrastructure/local/local-seller-logo-storage.adapter";
import { CloudflareR2SellerLogoStorageAdapter, type R2S3Client } from "../infrastructure/r2/cloudflare-r2-seller-logo-storage.adapter";
import { validateSellerLogoStorageConfiguration } from "../config/seller-logo-storage.config";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;
type CapturedCommand = Readonly<{ name: string; input: Record<string, unknown> }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];
const bucket = "phase10c-r1-bucket";

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function id(prefix = "seller_phase10cr1"): string {
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

async function expectsError(callback: () => Promise<unknown> | unknown, isExpected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
}

function capture(command: PutObjectCommand | DeleteObjectCommand): CapturedCommand {
  const candidate = command as unknown as { constructor: { name: string }; input: Record<string, unknown> };
  return { name: candidate.constructor.name, input: candidate.input };
}

class MockS3Client implements R2S3Client {
  readonly commands: CapturedCommand[] = [];
  failPut = false;
  failDelete = false;
  missingDelete = false;

  async send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown> {
    const captured = capture(command);
    this.commands.push(captured);
    if (captured.name === "PutObjectCommand" && this.failPut) {
      throw new Error("mock sdk put failure with SECRET_TEST_VALUE");
    }
    if (captured.name === "DeleteObjectCommand" && this.missingDelete) {
      const error = new Error("missing");
      error.name = "NoSuchKey";
      throw error;
    }
    if (captured.name === "DeleteObjectCommand" && this.failDelete) {
      throw new Error("mock sdk delete failure");
    }
    return {};
  }
}

class FailingProfileRepository extends PostgreSqlSellerWorkspaceProfileRepository {
  async updateLogoMetadata(
    tenant: ReturnType<typeof createTenantContext>,
    logo: SellerWorkspaceLogoMetadata,
    options?: SellerWorkspaceProfileRepositoryOptions,
  ): Promise<SellerWorkspaceProfile | null> {
    await Promise.resolve(tenant);
    await Promise.resolve(logo);
    await Promise.resolve(options);
    throw new Error("phase10cr1 metadata failure");
  }
}

async function createProfile(displayName = "R2 Store"): Promise<Readonly<{ sellerId: string; tenant: ReturnType<typeof createTenantContext> }>> {
  const sellerId = id();
  await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerId) });
  sellerIds.push(sellerId);
  await new PostgreSqlSellerWorkspaceProfileRepository().createProfile({ sellerId, displayName } satisfies CreateSellerWorkspaceProfileInput);
  return { sellerId, tenant: createTenantContext(sellerId) };
}

async function count(table: string): Promise<number> {
  if (!sellerIds.length) return 0;
  const result = await executeDatabaseQuery<CountRow>({
    text: `SELECT COUNT(*)::text AS count FROM ${table} WHERE seller_id = ANY($1::varchar[])`,
    values: [sellerIds],
  });
  return Number(result.rows[0]?.count ?? "0");
}

async function cleanup(): Promise<void> {
  if (sellerIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  }
}

function adapter(client: MockS3Client): CloudflareR2SellerLogoStorageAdapter {
  return new CloudflareR2SellerLogoStorageAdapter({
    endpoint: "https://mock.invalid",
    accessKeyId: "mock-access-key",
    secretAccessKey: "mock-secret-key",
    bucketName: bucket,
    client,
  });
}

async function runDeterministicChecks(): Promise<void> {
  const profileRepository = new PostgreSqlSellerWorkspaceProfileRepository();
  const pngProfile = await createProfile("R2 PNG");
  const pngClient = new MockS3Client();
  const pngMetadata = await new SellerLogoService({ storage: adapter(pngClient), profileRepository }).uploadOrReplaceLogo(pngProfile.tenant, png(), "image/png");
  const put = pngClient.commands.find((command) => command.name === "PutObjectCommand");
  const putBody = put?.input.Body;
  add("R2 PutObject contains correct bucket, key, body, and Content-Type", put?.input.Bucket === bucket && put.input.Key === pngMetadata.objectKey && Buffer.isBuffer(putBody) && putBody.equals(png()) && put.input.ContentType === "image/png");
  add("R2 object key is seller-scoped and random", pngMetadata.objectKey.startsWith(`seller-logos/${pngProfile.sellerId}/`) && pngMetadata.objectKey.endsWith(".png"));

  const jpegProfile = await createProfile("R2 JPEG");
  const jpegClient = new MockS3Client();
  const jpegMetadata = await new SellerLogoService({ storage: adapter(jpegClient), profileRepository }).uploadOrReplaceLogo(jpegProfile.tenant, jpeg(), "image/jpeg");
  add("R2 JPEG upload uses image/jpeg Content-Type", jpegClient.commands[0]?.input.ContentType === "image/jpeg" && jpegMetadata.objectKey.endsWith(".jpg"));

  const webpProfile = await createProfile("R2 WebP");
  const webpClient = new MockS3Client();
  const webpMetadata = await new SellerLogoService({ storage: adapter(webpClient), profileRepository }).uploadOrReplaceLogo(webpProfile.tenant, webp(), "image/webp");
  add("R2 WebP upload uses image/webp Content-Type", webpClient.commands[0]?.input.ContentType === "image/webp" && webpMetadata.objectKey.endsWith(".webp"));

  await adapter(pngClient).delete(pngMetadata.objectKey);
  const deleteCommand = pngClient.commands.find((command) => command.name === "DeleteObjectCommand");
  add("R2 DeleteObject contains correct bucket and key", deleteCommand?.input.Bucket === bucket && deleteCommand.input.Key === pngMetadata.objectKey);

  const missingDeleteClient = new MockS3Client();
  missingDeleteClient.missingDelete = true;
  await adapter(missingDeleteClient).delete(pngMetadata.objectKey);
  add("R2 missing-object deletion is idempotent", missingDeleteClient.commands[0]?.name === "DeleteObjectCommand");

  add("R2 arbitrary path rejection", await expectsError(
    () => adapter(new MockS3Client()).delete("seller-logos/seller/../bad.png"),
    (error) => error instanceof SellerLogoValidationError,
  ));

  const putFailureClient = new MockS3Client();
  putFailureClient.failPut = true;
  add("R2 upload SDK failure is sanitized", await expectsError(
    () => adapter(putFailureClient).store({ objectKey: createSellerLogoObjectKey("seller_phase10cr1_mock", "image/png"), bytes: png(), mimeType: "image/png" }),
    (error) => error instanceof SellerLogoStorageError && error.message === "Seller logo storage failed." && !error.message.includes("SECRET_TEST_VALUE"),
  ));

  const deleteFailureClient = new MockS3Client();
  deleteFailureClient.failDelete = true;
  add("R2 delete SDK failure is sanitized", await expectsError(
    () => adapter(deleteFailureClient).delete(pngMetadata.objectKey),
    (error) => error instanceof SellerLogoStorageError && error.message === "Seller logo storage failed.",
  ));

  const replaceProfile = await createProfile("R2 Replace Failure");
  const replaceGoodClient = new MockS3Client();
  const replaceService = new SellerLogoService({ storage: adapter(replaceGoodClient), profileRepository });
  const oldLogo = await replaceService.uploadOrReplaceLogo(replaceProfile.tenant, png(), "image/png");
  const replaceFailClient = new MockS3Client();
  replaceFailClient.failPut = true;
  add("Failed R2 replacement preserves old logo", await expectsError(
    () => new SellerLogoService({ storage: adapter(replaceFailClient), profileRepository }).uploadOrReplaceLogo(replaceProfile.tenant, jpeg(), "image/jpeg"),
    (error) => error instanceof SellerLogoStorageError,
  ));
  const afterFailedReplace = await profileRepository.findByTenantContext(replaceProfile.tenant);
  add("Profile metadata remains consistent after R2 upload failure", afterFailedReplace?.logoObjectKey === oldLogo.objectKey && afterFailedReplace.logoMimeType === oldLogo.mimeType);

  const metadataFailureProfile = await createProfile("R2 Metadata Failure");
  const metadataClient = new MockS3Client();
  const metadataService = new SellerLogoService({ storage: adapter(metadataClient), profileRepository });
  const oldMetadataLogo = await metadataService.uploadOrReplaceLogo(metadataFailureProfile.tenant, png(), "image/png");
  add("Failed metadata update removes new R2 object when safe", await expectsError(
    () => new SellerLogoService({ storage: adapter(metadataClient), profileRepository: new FailingProfileRepository() }).uploadOrReplaceLogo(metadataFailureProfile.tenant, jpeg(), "image/jpeg"),
    (error) => error instanceof Error,
  ));
  const deletedKeys = metadataClient.commands
    .filter((command) => command.name === "DeleteObjectCommand")
    .map((command) => command.input.Key);
  const afterMetadataFailure = await profileRepository.findByTenantContext(metadataFailureProfile.tenant);
  add("Failed metadata update preserves old profile metadata", afterMetadataFailure?.logoObjectKey === oldMetadataLogo.objectKey && deletedKeys.some((key) => key !== oldMetadataLogo.objectKey));

  add("Provider local selection returns local adapter", createSellerLogoStorageFromConfiguration({ provider: "local" }) instanceof LocalSellerLogoStorageAdapter);
  add("Provider r2 selection returns R2 adapter", createSellerLogoStorageFromConfiguration({
    provider: "r2",
    endpoint: "https://mock.invalid",
    accessKeyId: "access",
    secretAccessKey: "secret",
    bucketName: "bucket",
  }) instanceof CloudflareR2SellerLogoStorageAdapter);
  add("Missing R2 configuration is rejected", await expectsError(
    () => validateSellerLogoStorageConfiguration({ provider: "r2" }),
    (error) => error instanceof SellerLogoStorageConfigurationError,
  ));
  add("Malformed R2 endpoint is rejected", await expectsError(
    () => validateSellerLogoStorageConfiguration({ provider: "r2", endpoint: "http://example.invalid", accessKeyId: "a", secretAccessKey: "b", bucketName: "c" }),
    (error) => error instanceof SellerLogoStorageConfigurationError,
  ));
  add("No silent fallback for invalid provider", await expectsError(
    () => validateSellerLogoStorageConfiguration({ provider: "r-two" }),
    (error) => error instanceof SellerLogoStorageConfigurationError,
  ));
  add("Configuration errors do not leak secret values", !new SellerLogoStorageConfigurationError().message.includes("secret"));
}

function liveConfigPresent(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT?.trim() &&
    process.env.R2_ACCESS_KEY_ID?.trim() &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME?.trim(),
  );
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NotFound" || error.name === "NoSuchKey");
}

async function runLiveSmoke(): Promise<"PASSED" | "SKIPPED" | "FAILED"> {
  if (!liveConfigPresent()) return "SKIPPED";
  const configuration = validateSellerLogoStorageConfiguration({
    provider: "r2",
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
  });
  if (configuration.provider !== "r2") return "FAILED";
  const key = createSellerLogoObjectKey("seller_phase10cr1_smoke", "image/png");
  const client = new S3Client({
    region: "auto",
    endpoint: configuration.endpoint,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });
  try {
    await client.send(new PutObjectCommand({
      Bucket: configuration.bucketName,
      Key: key,
      Body: png(),
      ContentType: "image/png",
    }));
    await client.send(new HeadObjectCommand({
      Bucket: configuration.bucketName,
      Key: key,
    }));
    await client.send(new DeleteObjectCommand({
      Bucket: configuration.bucketName,
      Key: key,
    }));
    try {
      await client.send(new HeadObjectCommand({
        Bucket: configuration.bucketName,
        Key: key,
      }));
      return "FAILED";
    } catch (error) {
      return isNotFound(error) ? "PASSED" : "FAILED";
    }
  } catch {
    return "FAILED";
  } finally {
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: configuration.bucketName,
        Key: key,
      }));
    } catch {
      // Best-effort cleanup for the dedicated smoke-test object only.
    }
  }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("R2 storage imports and adapter construction do not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const constructionClient = new MockS3Client();
  const constructed = adapter(constructionClient);
  add("R2 adapter construction performs no S3 I/O", constructed instanceof CloudflareR2SellerLogoStorageAdapter && constructionClient.commands.length === 0);

  try {
    await runDeterministicChecks();
  } finally {
    await cleanup();
    add("Only Phase 10C-R1 database records are cleaned up", await count("seller_workspace_profiles") === 0 && await count("sellers") === 0);
    await closeDatabasePool();
  }

  const liveSmoke = await runLiveSmoke();
  add(`Live R2 smoke test ${liveSmoke}`, liveSmoke === "PASSED" || liveSmoke === "SKIPPED");

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length, liveSmoke },
    cases,
  })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 10C-R1 R2 storage test failed safely." })}\n`);
  process.exitCode = 1;
});
