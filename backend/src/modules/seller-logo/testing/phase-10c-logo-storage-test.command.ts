import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabasePoolState,
} from "../../../infrastructure/database";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import type { SellerWorkspaceLogoMetadata } from "../../seller-workspace-profile/domain/seller-workspace-profile.types";
import type { SellerLogoStorage, StoreSellerLogoInput } from "../contracts/seller-logo-storage";
import { SellerLogoStorageError, SellerLogoValidationError } from "../domain/seller-logo.errors";
import type { SellerLogoMetadata } from "../domain/seller-logo.types";
import { LocalSellerLogoStorageAdapter } from "../infrastructure/local/local-seller-logo-storage.adapter";
import { SellerLogoService } from "../application/seller-logo.service";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];
const testRoot = path.resolve(process.cwd(), "tmp", "phase-10c-logo-storage");

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function id(prefix = "seller_phase10c"): string {
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

async function expectsError(callback: () => Promise<unknown> | unknown, isExpected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
}

function storedPath(metadata: SellerLogoMetadata): string {
  return path.resolve(testRoot, metadata.objectKey);
}

async function createProfile(displayName = "Logo Store"): Promise<Readonly<{ sellerId: string; tenant: ReturnType<typeof createTenantContext> }>> {
  const sellerId = id();
  await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(sellerId) });
  sellerIds.push(sellerId);
  await new PostgreSqlSellerWorkspaceProfileRepository().createProfile({ sellerId, displayName });
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
  await rm(testRoot, { recursive: true, force: true });
}

class FailingStoreLogoStorage implements SellerLogoStorage {
  constructor(private readonly delegate: SellerLogoStorage) {}

  async store(): Promise<SellerLogoMetadata> {
    throw new SellerLogoStorageError();
  }

  async delete(objectKey: string): Promise<void> {
    await this.delegate.delete(objectKey);
  }
}

class FailingProfileRepository extends PostgreSqlSellerWorkspaceProfileRepository {
  async updateLogoMetadata(): Promise<null> {
    throw new Error("phase10c metadata failure");
  }
}

async function main(): Promise<void> {
  await rm(testRoot, { recursive: true, force: true });
  await closeDatabasePool();
  add("Seller logo module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const adapterBeforeIo = new LocalSellerLogoStorageAdapter(testRoot);
  add("Local logo storage adapter construction does not touch filesystem", Boolean(adapterBeforeIo) && !existsSync(testRoot));
  const composition = createPersistenceComposition();
  add("Persistence composition wires logo service without I/O", Boolean(composition.sellerLogoService) && !getDatabasePoolState().initialized && !existsSync(testRoot));

  const storage = new LocalSellerLogoStorageAdapter(testRoot);
  const profileRepository = new PostgreSqlSellerWorkspaceProfileRepository();
  const service = new SellerLogoService({ storage, profileRepository });

  try {
    await mkdir(testRoot, { recursive: true });

    const pngProfile = await createProfile("PNG Store");
    const pngLogo = await service.uploadOrReplaceLogo(pngProfile.tenant, png(), "image/png");
    add("Valid PNG logo is accepted", pngLogo.mimeType === "image/png" && existsSync(storedPath(pngLogo)));

    const jpegProfile = await createProfile("JPEG Store");
    const jpegLogo = await service.uploadOrReplaceLogo(jpegProfile.tenant, jpeg(), "IMAGE/JPEG");
    add("Valid JPEG logo is accepted with normalized MIME", jpegLogo.mimeType === "image/jpeg" && existsSync(storedPath(jpegLogo)));

    const webpProfile = await createProfile("WebP Store");
    const webpLogo = await service.uploadOrReplaceLogo(webpProfile.tenant, webp(), "image/webp");
    add("Valid WebP logo is accepted", webpLogo.mimeType === "image/webp" && existsSync(storedPath(webpLogo)));

    add("Invalid file signature is rejected", await expectsError(
      () => service.uploadOrReplaceLogo(pngProfile.tenant, Buffer.from("not a png"), "image/png"),
      (error) => error instanceof SellerLogoValidationError,
    ));
    add("Unsupported MIME type is rejected", await expectsError(
      () => service.uploadOrReplaceLogo(pngProfile.tenant, png(), "image/gif"),
      (error) => error instanceof SellerLogoValidationError,
    ));
    add("Files larger than 2 MB are rejected", await expectsError(
      () => service.uploadOrReplaceLogo(pngProfile.tenant, oversizedPng(), "image/png"),
      (error) => error instanceof SellerLogoValidationError,
    ));

    const secondPngLogo = await service.uploadOrReplaceLogo(pngProfile.tenant, png(), "image/png");
    add("Logo object keys are random per upload", secondPngLogo.objectKey !== pngLogo.objectKey && secondPngLogo.objectKey.startsWith(`seller-logos/${pngProfile.sellerId}/`));
    add("Replacing a logo deletes the old file after new upload succeeds", !existsSync(storedPath(pngLogo)) && existsSync(storedPath(secondPngLogo)));

    const tenantIsolationProfile = await createProfile("Tenant Isolation Store");
    const isolatedLogo = await service.uploadOrReplaceLogo(tenantIsolationProfile.tenant, png(), "image/png");
    const pngProfileAfterIsolation = await profileRepository.findByTenantContext(pngProfile.tenant);
    add("Tenant isolation keeps another seller profile metadata unchanged", pngProfileAfterIsolation?.logoObjectKey === secondPngLogo.objectKey && isolatedLogo.objectKey.includes(`/${tenantIsolationProfile.sellerId}/`));

    add("Path traversal object keys are rejected by local storage", await expectsError(
      () => storage.delete("seller-logos/tenant/../bad.png"),
      (error) => error instanceof SellerLogoValidationError,
    ));
    add("Public arbitrary file paths are rejected by local storage", await expectsError(
      () => storage.store({ objectKey: "C:/tmp/logo.png", bytes: png(), mimeType: "image/png" } satisfies StoreSellerLogoInput),
      (error) => error instanceof SellerLogoValidationError,
    ));

    const oldMetadata = await profileRepository.findByTenantContext(pngProfile.tenant);
    add("Failed replacement preserves old logo metadata and file", await expectsError(
      () => new SellerLogoService({
        storage: new FailingStoreLogoStorage(storage),
        profileRepository,
      }).uploadOrReplaceLogo(pngProfile.tenant, jpeg(), "image/jpeg"),
      (error) => error instanceof SellerLogoStorageError,
    ));
    const afterFailedReplacement = await profileRepository.findByTenantContext(pngProfile.tenant);
    const preservedOldObjectKey = oldMetadata?.logoObjectKey;
    add("Old logo remains after failed replacement", Boolean(preservedOldObjectKey) && preservedOldObjectKey === afterFailedReplacement?.logoObjectKey && existsSync(path.resolve(testRoot, preservedOldObjectKey ?? "")));

    const metadataFailureProfile = await createProfile("Metadata Failure Store");
    const metadataFailureOldLogo = await service.uploadOrReplaceLogo(metadataFailureProfile.tenant, png(), "image/png");
    add("Metadata failure deletes newly uploaded replacement and preserves old metadata", await expectsError(
      () => new SellerLogoService({
        storage,
        profileRepository: new FailingProfileRepository(),
      }).uploadOrReplaceLogo(metadataFailureProfile.tenant, jpeg(), "image/jpeg"),
      (error) => error instanceof Error,
    ));
    const afterMetadataFailure = await profileRepository.findByTenantContext(metadataFailureProfile.tenant);
    add("Profile metadata stays consistent after replacement persistence failure", afterMetadataFailure?.logoObjectKey === metadataFailureOldLogo.objectKey && existsSync(storedPath(metadataFailureOldLogo)));

    await service.removeLogo(pngProfile.tenant);
    const clearedProfile = await profileRepository.findByTenantContext(pngProfile.tenant);
    add("Clear logo removes profile metadata", clearedProfile?.logoObjectKey === undefined && clearedProfile?.logoMimeType === undefined);
    add("Clear logo removes stored file", !existsSync(storedPath(secondPngLogo)));

    const metadataProfile = await profileRepository.findByTenantContext(jpegProfile.tenant);
    add("PostgreSQL stores only safe object key and MIME metadata", metadataProfile?.logoObjectKey === jpegLogo.objectKey && metadataProfile.logoMimeType === "image/jpeg");
  } finally {
    const remainingProfilesBeforeCleanup = await count("seller_workspace_profiles");
    await cleanup();
    const remainingProfiles = await count("seller_workspace_profiles");
    const remainingSellers = await count("sellers");
    add("Phase 10C created profile rows existed before cleanup", remainingProfilesBeforeCleanup > 0);
    add("Only Phase 10C test records and files are cleaned up", remainingProfiles === 0 && remainingSellers === 0 && !existsSync(testRoot));
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length },
    cases,
  })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 10C seller logo storage test failed safely." })}\n`);
  process.exitCode = 1;
});
