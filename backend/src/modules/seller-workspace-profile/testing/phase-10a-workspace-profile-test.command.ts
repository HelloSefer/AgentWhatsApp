import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import {
  SellerWorkspaceProfileAlreadyExistsError,
  SellerWorkspaceProfileSellerNotFoundError,
  SellerWorkspaceProfileValidationError,
} from "../domain/seller-workspace-profile.errors";
import { normalizeWorkspaceDisplayName } from "../domain/seller-workspace-profile.validation";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../infrastructure/postgresql/postgresql-seller-workspace-profile.repository";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type ConstraintRow = Readonly<{ constraint_name: string }>;
type ColumnRow = Readonly<{ column_name: string }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix = "seller_phase10a"): string {
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
    text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])",
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
  add("Seller Workspace Profile module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const composition = createPersistenceComposition();
  add("Persistence composition wires the workspace profile repository without database I/O", Boolean(composition.sellerWorkspaceProfileRepository) && !getDatabasePoolState().initialized);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlSellerWorkspaceProfileRepository();
  const sellerA = uniqueId();
  const sellerB = uniqueId();
  const sellerFk = uniqueId();
  const sellerCollisionA = uniqueId();
  const sellerCollisionB = uniqueId();
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);

  try {
    add("Blank workspace names are rejected", await expectsError(
      () => repository.createProfile({ sellerId: sellerA, displayName: "   " }),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));
    add("default-seller workspace name is rejected", await expectsError(
      () => repository.createProfile({ sellerId: sellerA, displayName: " Default Seller " }),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));
    add("default seller id is rejected before persistence", await expectsError(
      () => repository.createProfile({ sellerId: "default-seller", displayName: "Real Store" }),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));
    add("Malformed intended WhatsApp phone is rejected", await expectsError(
      () => repository.createProfile({ sellerId: sellerA, displayName: "Real Store", intendedWhatsappPhoneE164: "212600000000" }),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));
    add("Unsafe logo object key is rejected", await expectsError(
      () => repository.createProfile({ sellerId: sellerA, displayName: "Real Store", logo: { objectKey: "https://example.com/logo.png", mimeType: "image/png" } }),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));
    add("Store name normalization preserves Unicode while trimming/collapsing spaces", normalizeWorkspaceDisplayName("  متجر   الأمل  ") === "متجر الأمل");

    const firstMigrationRun = await runDatabaseMigrations();
    const secondMigrationRun = await runDatabaseMigrations();
    const migrationStatus = await getDatabaseMigrationStatus();
    add("Workspace profile migration 0007 is applied", migrationStatus.applied.includes("0007"));
    add("Migration runner remains idempotent", Array.isArray(firstMigrationRun.applied) && secondMigrationRun.applied.length === 0);

    const columns = await executeDatabaseQuery<ColumnRow>({
      text: `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'seller_workspace_profiles'
        ORDER BY ordinal_position
      `,
    });
    add("Workspace profile table contains only expected columns", columns.rows.map((row) => row.column_name).join("|") === "seller_id|display_name|slug|intended_whatsapp_phone_e164|logo_object_key|logo_mime_type|onboarding_completed_at|created_at|updated_at");

    const constraints = await executeDatabaseQuery<ConstraintRow>({
      text: `
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = 'seller_workspace_profiles'
        ORDER BY constraint_name
      `,
    });
    const constraintNames = new Set(constraints.rows.map((row) => row.constraint_name));
    add("Migration installs one-to-one, foreign-key, phone, slug, and logo constraints", [
      "seller_workspace_profiles_pkey",
      "seller_workspace_profiles_seller_fk",
      "seller_workspace_profiles_phone_e164",
      "seller_workspace_profiles_slug_safe",
      "seller_workspace_profiles_logo_metadata_pair",
      "seller_workspace_profiles_logo_object_key_safe",
      "seller_workspace_profiles_logo_mime_type_safe",
    ].every((name) => constraintNames.has(name)));

    await createSeller(sellerService, sellerA);
    await createSeller(sellerService, sellerB);
    await createSeller(sellerService, sellerFk);
    await createSeller(sellerService, sellerCollisionA);
    await createSeller(sellerService, sellerCollisionB);

    add("Missing seller maps to a typed profile seller-not-found error", await expectsError(
      () => repository.createProfile({ sellerId: uniqueId("seller_phase10a_missing"), displayName: "Missing Seller Store" }),
      (error) => error instanceof SellerWorkspaceProfileSellerNotFoundError,
    ));

    const createdA = await repository.createProfile({
      sellerId: sellerA,
      displayName: "  Atlas   Market  ",
      intendedWhatsappPhoneE164: " +212 600-000-001 ",
      logo: { objectKey: "workspace-logos/phase10a/atlas.png", mimeType: "IMAGE/PNG" },
    });
    add("Profile can be created with normalized display name", createdA.displayName === "Atlas Market");
    add("Slug is generated by the backend", createdA.slug === "atlas-market");
    add("Intended WhatsApp phone is normalized to E.164 only", createdA.intendedWhatsappPhoneE164 === "+212600000001");
    add("Logo metadata is normalized without logo bytes or URLs", createdA.logoObjectKey === "workspace-logos/phase10a/atlas.png" && createdA.logoMimeType === "image/png");
    add("Created profile has timestamps", createdA.createdAt instanceof Date && createdA.updatedAt instanceof Date);

    const foundA = await repository.findByTenantContext(tenantA);
    add("Profile can be read by trusted TenantContext", foundA?.sellerId === sellerA && foundA.slug === createdA.slug);
    add("Onboarding profile existence returns true", await repository.onboardingProfileExists(tenantA));
    add("Missing tenant profile existence returns false", (await repository.onboardingProfileExists(tenantB)) === false);

    const createdB = await repository.createProfile({
      sellerId: sellerB,
      displayName: "متجر الأمل",
      intendedWhatsappPhoneE164: null,
    });
    add("Unicode display names round-trip through PostgreSQL", createdB.displayName === "متجر الأمل");
    add("Optional phone can be omitted without implying connection", createdB.intendedWhatsappPhoneE164 === undefined);
    add("Tenant isolation prevents Seller A from reading Seller B profile", (await repository.findByTenantContext(tenantA))?.displayName !== createdB.displayName);

    const updatedName = await repository.updateDisplayName(tenantA, "  Atlas   Premium  ");
    add("Display name can be updated without regenerating slug", updatedName?.displayName === "Atlas Premium" && updatedName.slug === createdA.slug);
    const updatedPhone = await repository.updateIntendedPhone(tenantA, "+212 (600) 000-002");
    add("Intended phone can be updated with safe normalization", updatedPhone?.intendedWhatsappPhoneE164 === "+212600000002");
    const clearedPhone = await repository.updateIntendedPhone(tenantA, null);
    add("Intended phone can be cleared", clearedPhone?.intendedWhatsappPhoneE164 === undefined);
    const updatedLogo = await repository.updateLogoMetadata(tenantA, { objectKey: "workspace-logos/phase10a/atlas.webp", mimeType: "image/webp" });
    add("Logo metadata can be updated", updatedLogo?.logoObjectKey === "workspace-logos/phase10a/atlas.webp" && updatedLogo.logoMimeType === "image/webp");
    const clearedLogo = await repository.clearLogoMetadata(tenantA);
    add("Logo metadata can be cleared", clearedLogo?.logoObjectKey === undefined && clearedLogo?.logoMimeType === undefined);

    add("Unique seller profile is enforced and mapped", await expectsError(
      () => repository.createProfile({ sellerId: sellerA, displayName: "Another Atlas" }),
      (error) => error instanceof SellerWorkspaceProfileAlreadyExistsError,
    ));

    const collisionA = await repository.createProfile({ sellerId: sellerCollisionA, displayName: "Slug Collision Store" });
    const collisionB = await repository.createProfile({ sellerId: sellerCollisionB, displayName: "Slug Collision Store" });
    add("Unique slug constraint keeps slugs distinct", collisionA.slug === "slug-collision-store" && collisionB.slug !== collisionA.slug);
    add("Slug collision handling preserves readable generated base", collisionB.slug.startsWith("slug-collision-store-"));

    add("Malformed phone update is rejected", await expectsError(
      () => repository.updateIntendedPhone(tenantA, "+0123"),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));
    add("Unsafe logo MIME type is rejected", await expectsError(
      () => repository.updateLogoMetadata(tenantA, { objectKey: "workspace-logos/phase10a/bad.svg", mimeType: "image/svg+xml" }),
      (error) => error instanceof SellerWorkspaceProfileValidationError,
    ));

    add("Database rejects blank display names", await expectsError(
      () => executeDatabaseQuery({
        text: "INSERT INTO seller_workspace_profiles (seller_id, display_name, slug) VALUES ($1, $2, $3)",
        values: [sellerFk, " ", "phase10a-db-blank"],
      }),
      (error) => error instanceof Error,
    ));
    add("Database rejects malformed phone values", await expectsError(
      () => executeDatabaseQuery({
        text: "INSERT INTO seller_workspace_profiles (seller_id, display_name, slug, intended_whatsapp_phone_e164) VALUES ($1, $2, $3, $4)",
        values: [sellerFk, "DB Phone Guard", "phase10a-db-phone", "not-a-phone"],
      }),
      (error) => error instanceof Error,
    ));
    add("Database rejects unsafe logo metadata pairs", await expectsError(
      () => executeDatabaseQuery({
        text: "INSERT INTO seller_workspace_profiles (seller_id, display_name, slug, logo_object_key, logo_mime_type) VALUES ($1, $2, $3, $4, $5)",
        values: [sellerFk, "DB Logo Guard", "phase10a-db-logo", "../bad.png", "image/png"],
      }),
      (error) => error instanceof Error,
    ));

    const fkProfile = await repository.createProfile({ sellerId: sellerFk, displayName: "FK Behavior Store" });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = $1", values: [sellerFk] });
    const fkRows = await executeDatabaseQuery<CountRow>({
      text: "SELECT COUNT(*)::text AS count FROM seller_workspace_profiles WHERE seller_id = $1",
      values: [fkProfile.sellerId],
    });
    add("Foreign-key behavior cascades profile deletion from Seller root", fkRows.rows[0]?.count === "0");
  } finally {
    await cleanup();
    const remaining = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({
        text: "SELECT COUNT(*)::text AS count FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])",
        values: [sellerIds],
      })
      : { rows: [{ count: "0" }] };
    const remainingSellers = sellerIds.length
      ? await executeDatabaseQuery<CountRow>({
        text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])",
        values: [sellerIds],
      })
      : { rows: [{ count: "0" }] };
    add("Only Phase 10A profile test rows are cleaned up", remaining.rows[0]?.count === "0" && remainingSellers.rows[0]?.count === "0");
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
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 10A seller workspace profile persistence test failed safely." })}\n`);
  process.exitCode = 1;
});
