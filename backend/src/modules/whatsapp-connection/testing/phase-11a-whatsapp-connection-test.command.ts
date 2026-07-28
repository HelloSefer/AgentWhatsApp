import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
  InvalidTenantContextError,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
} from "../index";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

async function expectsError(callback: () => Promise<unknown> | unknown, isExpected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({
    text: "DELETE FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
  await executeDatabaseQuery({
    text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
}

async function createSeller(service: SellerService, sellerId: string): Promise<void> {
  await service.createSeller(sellerId);
  sellerIds.push(sellerId);
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("WhatsApp Connection module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlWhatsAppConnectionRepository();
  const sellerA = uniqueId("seller_phase11a");
  const sellerB = uniqueId("seller_phase11a");
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);
  const phoneA = uniqueId("phone_phase11a");
  const phoneAReplacement = uniqueId("phone_phase11a");
  const inactivePhoneB = uniqueId("phone_phase11a");

  try {
    add("Blank seller contexts are rejected by trusted TenantContext", expectsTenantRejection("   "));
    add("default seller contexts are rejected by trusted TenantContext", expectsTenantRejection(" default_seller "));

    const firstMigrationRun = await runDatabaseMigrations();
    const secondMigrationRun = await runDatabaseMigrations();
    const migrationStatus = await getDatabaseMigrationStatus();
    add("WhatsApp connection migration 0008 is applied explicitly", migrationStatus.applied.includes("0008"));
    add("Migration runner remains idempotent after WhatsApp connection registration", Array.isArray(firstMigrationRun.applied) && secondMigrationRun.applied.length === 0);

    await createSeller(sellerService, sellerA);
    await createSeller(sellerService, sellerB);

    const candidateA = await repository.createCandidate(tenantA);
    add("Connection candidate is created for the authenticated seller", candidateA.sellerId === sellerA && candidateA.provider === "META_WHATSAPP_CLOUD_API" && candidateA.status === "PENDING");
    add("Candidate creation assigns stable identifiers and timestamps", Boolean(candidateA.connectionId) && candidateA.createdAt instanceof Date && candidateA.updatedAt instanceof Date);

    add("Tenant-isolated connection reads do not cross sellers", await repository.findByConnectionId(tenantB, candidateA.connectionId) === null);
    add("Seller-scoped current connections include the seller candidate", (await repository.findCurrentForSeller(tenantA)).some((connection) => connection.connectionId === candidateA.connectionId));
    add("Seller-scoped all connections remain isolated", (await repository.findAllForSeller(tenantB)).length === 0);

    const verifyingA = await repository.updateLifecycleStatus(tenantA, candidateA.connectionId, "VERIFYING");
    const verifiedA = await repository.persistVerifiedMetadata(tenantA, candidateA.connectionId, {
      metaBusinessId: " meta-business-phase11a ",
      wabaId: " waba-phase11a ",
      phoneNumberId: ` ${phoneA} `,
      displayPhoneNumber: " +212 600 000 011 ",
      verifiedName: " Atlas Verified ",
    });
    const activeA = await repository.updateLifecycleStatus(tenantA, candidateA.connectionId, "ACTIVE");
    add("Lifecycle status updates are tenant-scoped and safe", verifyingA?.status === "VERIFYING" && activeA?.status === "ACTIVE" && Boolean(activeA.connectedAt));
    add("Verified non-secret Meta metadata is persisted and normalized", verifiedA?.metaBusinessId === "meta-business-phase11a" && verifiedA.wabaId === "waba-phase11a" && verifiedA.phoneNumberId === phoneA && verifiedA.displayPhoneNumber === "+212 600 000 011" && verifiedA.verifiedName === "Atlas Verified" && Boolean(verifiedA.lastVerifiedAt));

    const activeBySeller = await repository.findActiveBySeller(tenantA);
    add("ACTIVE lookup by trusted seller returns the active connection", activeBySeller?.connectionId === candidateA.connectionId && activeBySeller.sellerId === sellerA);

    const resolvedA = await repository.resolveActiveByPhoneNumberId(phoneA);
    add("ACTIVE lookup by phone_number_id returns the trusted persisted seller", resolvedA?.sellerId === sellerA && resolvedA.connection.connectionId === candidateA.connectionId);

    const replacementA = await repository.createCandidate(tenantA);
    await repository.persistVerifiedMetadata(tenantA, replacementA.connectionId, { phoneNumberId: phoneAReplacement });
    add("One ACTIVE connection per seller is enforced", await expectsError(
      () => repository.updateLifecycleStatus(tenantA, replacementA.connectionId, "ACTIVE"),
      (error) => error instanceof WhatsAppConnectionActiveAlreadyExistsError,
    ));

    const candidateB = await repository.createCandidate(tenantB);
    add("The same phone_number_id cannot be assigned across sellers", await expectsError(
      () => repository.persistVerifiedMetadata(tenantB, candidateB.connectionId, { phoneNumberId: phoneA }),
      (error) => error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError,
    ));

    await repository.persistVerifiedMetadata(tenantB, candidateB.connectionId, { phoneNumberId: inactivePhoneB, verifiedName: "Inactive B" });
    await repository.updateLifecycleStatus(tenantB, candidateB.connectionId, "VERIFYING");
    add("Inactive phone_number_id does not resolve for inbound routing", await repository.resolveActiveByPhoneNumberId(inactivePhoneB) === null);
    add("Unknown phone_number_id does not resolve for inbound routing", await repository.resolveActiveByPhoneNumberId(uniqueId("phone_unknown_phase11a")) === null);

    const disconnectedA = await repository.updateLifecycleStatus(tenantA, candidateA.connectionId, "DISCONNECTED");
    add("Disconnected lifecycle metadata is recorded", disconnectedA?.status === "DISCONNECTED" && Boolean(disconnectedA.disconnectedAt));
    add("Disconnected phone_number_id no longer resolves", await repository.resolveActiveByPhoneNumberId(phoneA) === null);

    const columns = await executeDatabaseQuery<{ column_name: string }>({
      text: `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'whatsapp_connections'
        ORDER BY ordinal_position
      `,
    });
    add("WhatsApp connection table contains the Phase 11A and nullable onboarding persistence shape", columns.rows.map((row) => row.column_name).join("|") === "connection_id|seller_id|provider|status|meta_business_id|waba_id|phone_number_id|display_phone_number|verified_name|connected_at|last_verified_at|disconnected_at|created_at|updated_at|encrypted_access_token|token_key_version|token_fingerprint|token_expires_at|encrypted_registration_pin|registration_pin_key_version|registration_pin_fingerprint|phone_registration_completed_at|waba_subscription_completed_at|finalization_last_error_code|finalization_last_error_at");
  } finally {
    await cleanup();
    const remaining = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({
        text: "SELECT COUNT(*)::text AS count FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])",
        values: [sellerIds],
      })
      : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({
        text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])",
        values: [sellerIds],
      })
      : { rows: [{ count: "0" }] };
    add("Only Phase 11A WhatsApp connection test rows are cleaned up", remaining.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length },
    cases,
  })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

function expectsTenantRejection(sellerId: unknown): boolean {
  try {
    createTenantContext(sellerId);
    return false;
  } catch (error) {
    return error instanceof InvalidTenantContextError;
  }
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 11A WhatsApp connection persistence test failed safely." })}\n`);
  process.exitCode = 1;
});
