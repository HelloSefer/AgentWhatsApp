import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { WhatsAppConnectionCredentialEncryptionService, WhatsAppConnectionCredentialEncryptionError, WhatsAppConnectionCredentialService, PostgreSqlWhatsAppConnectionRepository } from "../index";
import { validateWhatsAppConnectionCredentialEncryptionConfiguration } from "../application/whatsapp-connection-credential-encryption.config";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;
type RawCredentialRow = Readonly<{
  encrypted_access_token: string | null;
  token_key_version: string | null;
  token_fingerprint: string | null;
  token_expires_at: Date | string | null;
}>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function encodedKey(): string {
  return randomBytes(32).toString("base64");
}

function service(activeKeyVersion: string, keys: Record<string, string>): WhatsAppConnectionCredentialEncryptionService {
  return new WhatsAppConnectionCredentialEncryptionService(validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion,
    keysJson: JSON.stringify(keys),
  }));
}

async function expectsError(callback: () => Promise<unknown> | unknown, isExpected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
}

function parsedEnvelope(encryptedAccessToken: string): Record<string, string | number> {
  return JSON.parse(encryptedAccessToken) as Record<string, string | number>;
}

function tamperedEnvelope(encryptedAccessToken: string, field: "ciphertext" | "tag" | "keyVersion" | "iv", value: string): string {
  const envelope = parsedEnvelope(encryptedAccessToken);
  envelope[field] = value;
  return JSON.stringify(envelope);
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
}

async function createSeller(service: SellerService, sellerId: string): Promise<void> {
  await service.createSeller(sellerId);
  sellerIds.push(sellerId);
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("WhatsApp credential module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const oldKey = encodedKey();
  const activeKey = encodedKey();
  const alternateKey = encodedKey();
  const token = `phase11b_token_${randomUUID().replace(/-/gu, "")}`;
  const replacementToken = `phase11b_token_${randomUUID().replace(/-/gu, "")}`;
  const encryption = service("v2", { v1: oldKey, v2: activeKey });
  const oldEncryption = service("v1", { v1: oldKey });

  add("Missing encryption configuration fails closed", expectsConfigurationFailure({ activeKeyVersion: "", keysJson: "" }));
  add("Unknown active key version fails closed", expectsConfigurationFailure({ activeKeyVersion: "missing", keysJson: JSON.stringify({ v1: activeKey }) }));
  add("Invalid key length fails closed", expectsConfigurationFailure({ activeKeyVersion: "v1", keysJson: JSON.stringify({ v1: Buffer.from("short").toString("base64") }) }));
  add("Malformed key configuration fails closed", expectsConfigurationFailure({ activeKeyVersion: "v1", keysJson: "not-json" }));

  const encrypted = encryption.encryptAccessToken(token);
  const encryptedAgain = encryption.encryptAccessToken(token);
  add("Encrypt/decrypt round trip returns the original token only on explicit decrypt", encryption.decryptAccessToken(encrypted.encryptedAccessToken) === token);
  add("Same plaintext produces different ciphertext because IVs differ", encrypted.encryptedAccessToken !== encryptedAgain.encryptedAccessToken && parsedEnvelope(encrypted.encryptedAccessToken).iv !== parsedEnvelope(encryptedAgain.encryptedAccessToken).iv);
  add("Tampered ciphertext fails closed", expectsCredentialFailure(() => encryption.decryptAccessToken(tamperedEnvelope(encrypted.encryptedAccessToken, "ciphertext", Buffer.from("tampered").toString("base64")))));
  add("Tampered authentication tag fails closed", expectsCredentialFailure(() => encryption.decryptAccessToken(tamperedEnvelope(encrypted.encryptedAccessToken, "tag", randomBytes(16).toString("base64")))));
  add("Unknown stored key version fails closed", expectsCredentialFailure(() => encryption.decryptAccessToken(tamperedEnvelope(encrypted.encryptedAccessToken, "keyVersion", "unknown"))));
  add("Malformed envelope fails safely", expectsCredentialFailure(() => encryption.decryptAccessToken("{\"v\":1,\"alg\":\"AES-256-GCM\"}")));
  add("Wrong configured key for stored version fails authentication", expectsCredentialFailure(() => service("v2", { v2: alternateKey }).decryptAccessToken(encrypted.encryptedAccessToken)));

  const oldEncrypted = oldEncryption.encryptAccessToken(token);
  add("Active key encrypts while an older configured key can still decrypt", parsedEnvelope(encrypted.encryptedAccessToken).keyVersion === "v2" && encryption.decryptAccessToken(oldEncrypted.encryptedAccessToken) === token);
  add("Fingerprint is stable for the same token", encrypted.tokenFingerprint === encryptedAgain.tokenFingerprint);
  add("Fingerprint does not contain the token and differs for another token", !encrypted.tokenFingerprint.includes(token) && encrypted.tokenFingerprint !== encryption.encryptAccessToken(replacementToken).tokenFingerprint);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const credentialService = new WhatsAppConnectionCredentialService(repository, encryption);
  const sellerId = uniqueId("seller_phase11b");
  const tenant = createTenantContext(sellerId);

  try {
    const firstMigrationRun = await runDatabaseMigrations();
    const secondMigrationRun = await runDatabaseMigrations();
    const migrationStatus = await getDatabaseMigrationStatus();
    add("WhatsApp credential migration 0009 is applied explicitly", migrationStatus.applied.includes("0009"));
    add("Migration runner remains idempotent after credential registration", Array.isArray(firstMigrationRun.applied) && secondMigrationRun.applied.length === 0);

    await createSeller(sellerService, sellerId);
    const candidate = await repository.createCandidate(tenant);
    add("Nullable credential state remains valid for Phase 11A candidates", await repository.findCredentialStorage(tenant, candidate.connectionId) === null);

    const publicBefore = await repository.findByConnectionId(tenant, candidate.connectionId);
    add("Public candidate serialization does not expose credential fields", !JSON.stringify(publicBefore).includes("token") && !JSON.stringify(publicBefore).includes("encrypted"));

    const expiresAt = new Date(Date.now() + 60_000);
    const stored = await credentialService.storeAccessToken(tenant, candidate.connectionId, { accessToken: token, tokenExpiresAt: expiresAt });
    add("Encrypted credential fields persist correctly", Boolean(stored?.encryptedAccessToken) && stored?.tokenKeyVersion === "v2" && stored.tokenFingerprint === encrypted.tokenFingerprint && stored.tokenExpiresAt instanceof Date);
    add("Stored credential decrypts only through trusted internal service", await credentialService.decryptStoredAccessToken(tenant, candidate.connectionId) === token);

    const raw = await executeDatabaseQuery<RawCredentialRow>({
      text: "SELECT encrypted_access_token, token_key_version, token_fingerprint, token_expires_at FROM whatsapp_connections WHERE seller_id = $1 AND connection_id = $2 LIMIT 1",
      values: [sellerId, candidate.connectionId],
    });
    const rawRow = raw.rows[0];
    add("Plaintext token is not persisted", Boolean(rawRow?.encrypted_access_token) && rawRow?.encrypted_access_token !== token && !String(rawRow?.encrypted_access_token).includes(token) && rawRow.token_fingerprint !== token);
    add("Encrypted credential storage includes only the envelope and non-secret metadata", rawRow?.token_key_version === "v2" && rawRow.token_fingerprint === stored?.tokenFingerprint && rawRow.token_expires_at !== null);

    const publicAfter = await repository.findByConnectionId(tenant, candidate.connectionId);
    const publicList = await repository.findAllForSeller(tenant);
    add("Public connection results do not expose credential fields after storage", !JSON.stringify(publicAfter).includes("encryptedAccessToken") && !JSON.stringify(publicAfter).includes("tokenFingerprint") && !JSON.stringify(publicList).includes("encryptedAccessToken") && !JSON.stringify(publicList).includes("tokenKeyVersion"));

    const badCandidate = await repository.createCandidate(tenant);
    add("Database all-present-or-all-absent credential constraint is enforced", await expectsError(
      () => executeDatabaseQuery({
        text: "UPDATE whatsapp_connections SET encrypted_access_token = $3 WHERE seller_id = $1 AND connection_id = $2",
        values: [sellerId, badCandidate.connectionId, stored?.encryptedAccessToken ?? "encrypted"],
      }),
      (error) => error instanceof Error,
    ));
  } finally {
    await cleanup();
    const remaining = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] })
      : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] })
      : { rows: [{ count: "0" }] };
    add("Only Phase 11B credential test rows are cleaned up", remaining.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

function expectsConfigurationFailure(input: { activeKeyVersion?: string; keysJson?: string }): boolean {
  try {
    validateWhatsAppConnectionCredentialEncryptionConfiguration(input);
    return false;
  } catch (error) {
    return error instanceof WhatsAppConnectionCredentialEncryptionError;
  }
}

function expectsCredentialFailure(callback: () => unknown): boolean {
  try {
    callback();
    return false;
  } catch (error) {
    return error instanceof WhatsAppConnectionCredentialEncryptionError;
  }
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11B WhatsApp credential encryption test failed safely." })}\n`);
  process.exitCode = 1;
});
