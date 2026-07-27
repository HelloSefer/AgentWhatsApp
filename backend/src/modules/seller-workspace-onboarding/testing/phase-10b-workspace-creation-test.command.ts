import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
} from "../../../infrastructure/database";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { PostgreSqlAuthRepository } from "../../auth";
import type { RepositoryOptions } from "../../auth/contracts/auth.repository";
import type { SellerMembership } from "../../auth/domain/auth.types";
import { PostgreSqlConversationConfigRepository } from "../../conversation-config";
import type { ConversationConfigRepositoryOptions } from "../../conversation-config/contracts/conversation-config.repository";
import type { PersistedConversationConfig } from "../../conversation-config/domain/persisted-conversation-config.types";
import type { ConversationConfigurationOverride } from "../../conversation-engine";
import { PostgreSqlSellerRepository, validateSellerId } from "../../seller";
import type { CreateSellerInput, SellerRepositoryOptions } from "../../seller/contracts/seller.repository";
import type { Seller } from "../../seller/domain/seller";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import type {
  CreateSellerWorkspaceProfileInput,
  SellerWorkspaceProfileRepositoryOptions,
} from "../../seller-workspace-profile/contracts/seller-workspace-profile.repository";
import type { SellerWorkspaceProfile } from "../../seller-workspace-profile/domain/seller-workspace-profile.types";
import {
  SellerWorkspaceOnboardingInactiveUserError,
  SellerWorkspaceOnboardingInconsistentStateError,
} from "../domain/seller-workspace-onboarding.errors";
import { SellerWorkspaceOnboardingService } from "../application/seller-workspace-onboarding.service";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type CountRow = Readonly<{ count: string }>;

const cases: TestCase[] = [];
const userIds: string[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

async function expectsError(callback: () => Promise<unknown>, isExpected: (error: unknown) => boolean): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return isExpected(error);
  }
}

async function createUser(authRepository: PostgreSqlAuthRepository, status: "active" | "disabled" = "active"): Promise<string> {
  const userId = id("user_phase10b");
  await authRepository.createUser({
    userId,
    emailNormalized: `${userId}@example.test`,
    status,
  });
  userIds.push(userId);
  return userId;
}

function service(dependencies?: Partial<ConstructorParameters<typeof SellerWorkspaceOnboardingService>[0]>): SellerWorkspaceOnboardingService {
  return new SellerWorkspaceOnboardingService({
    authRepository: dependencies?.authRepository ?? new PostgreSqlAuthRepository(),
    sellerRepository: dependencies?.sellerRepository ?? new PostgreSqlSellerRepository(),
    profileRepository: dependencies?.profileRepository ?? new PostgreSqlSellerWorkspaceProfileRepository(),
    conversationConfigRepository: dependencies?.conversationConfigRepository ?? new PostgreSqlConversationConfigRepository(),
  });
}

async function count(table: string, column: string, values: readonly string[]): Promise<number> {
  if (!values.length) return 0;
  const result = await executeDatabaseQuery<CountRow>({
    text: `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${column} = ANY($1::text[])`,
    values: [values],
  });
  return Number(result.rows[0]?.count ?? "0");
}

async function workspaceCounts(userId: string, sellerId: string): Promise<Readonly<{
  sellers: number;
  profiles: number;
  memberships: number;
  configs: number;
}>> {
  const [sellers, profiles, memberships, configs] = await Promise.all([
    count("sellers", "seller_id", [sellerId]),
    count("seller_workspace_profiles", "seller_id", [sellerId]),
    count("seller_memberships", "user_id", [userId]),
    count("seller_conversation_configs", "seller_id", [sellerId]),
  ]);
  return { sellers, profiles, memberships, configs };
}

async function cleanup(): Promise<void> {
  if (sellerIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_memberships WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  }
  if (userIds.length) {
    await executeDatabaseQuery({ text: "DELETE FROM auth_users WHERE user_id = ANY($1::text[])", values: [userIds] });
  }
}

class TrackingSellerRepository extends PostgreSqlSellerRepository {
  readonly createdSellerIds: string[] = [];

  async create(input: CreateSellerInput, options?: SellerRepositoryOptions): Promise<Seller> {
    const seller = await super.create(input, options);
    this.createdSellerIds.push(seller.sellerId);
    sellerIds.push(seller.sellerId);
    return seller;
  }
}

class FailingSellerRepository extends TrackingSellerRepository {
  async create(): Promise<Seller> {
    throw new Error("phase10b seller failure");
  }
}

class FailingProfileRepository extends PostgreSqlSellerWorkspaceProfileRepository {
  async createProfile(input: CreateSellerWorkspaceProfileInput, options?: SellerWorkspaceProfileRepositoryOptions): Promise<SellerWorkspaceProfile> {
    await Promise.resolve(input);
    await Promise.resolve(options);
    throw new Error("phase10b profile failure");
  }
}

class FailingAuthRepository extends PostgreSqlAuthRepository {
  async createSellerMembership(): Promise<SellerMembership> {
    throw new Error("phase10b owner membership failure");
  }
}

class FailingConversationConfigRepository extends PostgreSqlConversationConfigRepository {
  async saveSellerOverride(
    tenant: ReturnType<typeof createTenantContext>,
    config: ConversationConfigurationOverride,
    options?: ConversationConfigRepositoryOptions,
  ): Promise<PersistedConversationConfig> {
    await Promise.resolve(tenant);
    await Promise.resolve(config);
    await Promise.resolve(options);
    throw new Error("phase10b default config failure");
  }
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Workspace onboarding module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);
  const composition = createPersistenceComposition();
  add("Persistence composition wires onboarding without database I/O", Boolean(composition.sellerWorkspaceOnboardingService) && !getDatabasePoolState().initialized);

  const migrationStatus = await getDatabaseMigrationStatus();
  add("Phase 10A migration 0007 is already applied", migrationStatus.applied.includes("0007"));

  const authRepository = new PostgreSqlAuthRepository();

  try {
    const userA = await createUser(authRepository);
    const createdA = await service().createWorkspace({
      userId: userA,
      storeName: "Atlas Workspace",
    });
    sellerIds.push(createdA.sellerId);
    add("Workspace can be created successfully", createdA.status === "created" && createdA.sellerId.startsWith("seller_"));
    add("Client does not provide sellerId or slug", createdA.profile.sellerId === createdA.sellerId && createdA.profile.slug === "atlas-workspace");
    add("Optional phone can be absent", createdA.profile.intendedWhatsappPhoneE164 === undefined);
    add("OWNER membership is created for authenticated user", createdA.ownerMembership.userId === userA && createdA.ownerMembership.role === "OWNER" && createdA.ownerMembership.status === "active");
    add("Default seller conversation configuration is created", createdA.defaultConversationConfig.config.schemaVersion === 1);
    add("needsOnboarding becomes false through current membership state", (await service().needsOnboarding(userA)) === false);
    const countsA = await workspaceCounts(userA, createdA.sellerId);
    add("Created workspace has exactly one Seller/profile/membership/config", countsA.sellers === 1 && countsA.profiles === 1 && countsA.memberships === 1 && countsA.configs === 1);

    const userPhone = await createUser(authRepository);
    const createdPhone = await service().createWorkspace({
      userId: userPhone,
      storeName: "Phone Store",
      intendedWhatsAppPhone: " +212 (600) 000-003 ",
    });
    sellerIds.push(createdPhone.sellerId);
    add("Optional intended WhatsApp phone can be present as unverified metadata", createdPhone.profile.intendedWhatsappPhoneE164 === "+212600000003");

    const userUnicode = await createUser(authRepository);
    const createdUnicode = await service().createWorkspace({
      userId: userUnicode,
      storeName: "  متجر   الأمل  ",
    });
    sellerIds.push(createdUnicode.sellerId);
    add("Unicode store name is preserved in workspace profile", createdUnicode.profile.displayName === "متجر الأمل");

    const repeated = await service().createWorkspace({ userId: userA, storeName: "Ignored Repeat Name" });
    add("Repeated request returns the existing single workspace", repeated.status === "existing" && repeated.sellerId === createdA.sellerId && repeated.profile.displayName === createdA.profile.displayName);
    const countsAfterRepeat = await workspaceCounts(userA, createdA.sellerId);
    add("Repeated request does not create another Seller/profile/membership/config", countsAfterRepeat.sellers === 1 && countsAfterRepeat.profiles === 1 && countsAfterRepeat.memberships === 1 && countsAfterRepeat.configs === 1);

    const userConcurrent = await createUser(authRepository);
    const [concurrentA, concurrentB] = await Promise.all([
      service().createWorkspace({ userId: userConcurrent, storeName: "Concurrent Store" }),
      service().createWorkspace({ userId: userConcurrent, storeName: "Concurrent Store" }),
    ]);
    sellerIds.push(concurrentA.sellerId);
    add("Concurrent requests return the same workspace", concurrentA.sellerId === concurrentB.sellerId);
    add("Concurrent requests produce one created result and one existing result", [concurrentA.status, concurrentB.status].sort().join("|") === "created|existing");
    const concurrentCounts = await workspaceCounts(userConcurrent, concurrentA.sellerId);
    add("Concurrent requests create exactly one Seller/profile/OWNER membership/default config", concurrentCounts.sellers === 1 && concurrentCounts.profiles === 1 && concurrentCounts.memberships === 1 && concurrentCounts.configs === 1);

    const inactiveUser = await createUser(authRepository, "disabled");
    add("Inactive authenticated user is rejected", await expectsError(
      () => service().createWorkspace({ userId: inactiveUser, storeName: "Inactive Store" }),
      (error) => error instanceof SellerWorkspaceOnboardingInactiveUserError,
    ));

    const existingUser = await createUser(authRepository);
    const existingSeller = id("seller_phase10b_existing");
    await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(existingSeller) });
    sellerIds.push(existingSeller);
    const existingTenant = createTenantContext(existingSeller);
    await new PostgreSqlSellerWorkspaceProfileRepository().createProfile({ sellerId: existingSeller, displayName: "Existing Store" });
    await authRepository.createSellerMembership({ sellerId: existingSeller, userId: existingUser, role: "OWNER", status: "active" });
    await new PostgreSqlConversationConfigRepository().saveSellerOverride(existingTenant, { schemaVersion: 1 });
    const existingResult = await service().createWorkspace({ userId: existingUser, storeName: "Should Not Create" });
    add("Existing completed membership returns existing workspace safely", existingResult.status === "existing" && existingResult.sellerId === existingSeller);

    const inconsistentUser = await createUser(authRepository);
    const inconsistentSeller = id("seller_phase10b_inconsistent");
    await new PostgreSqlSellerRepository().create({ sellerId: validateSellerId(inconsistentSeller) });
    sellerIds.push(inconsistentSeller);
    await authRepository.createSellerMembership({ sellerId: inconsistentSeller, userId: inconsistentUser, role: "AGENT", status: "active" });
    add("Inconsistent existing active membership fails safely", await expectsError(
      () => service().createWorkspace({ userId: inconsistentUser, storeName: "Bad Existing State" }),
      (error) => error instanceof SellerWorkspaceOnboardingInconsistentStateError,
    ));

    const rollbackSellerUser = await createUser(authRepository);
    const failingSeller = new FailingSellerRepository();
    add("Seller creation failure fails safely", await expectsError(
      () => service({ sellerRepository: failingSeller }).createWorkspace({ userId: rollbackSellerUser, storeName: "Seller Failure" }),
      (error) => error instanceof Error,
    ));
    add("Seller creation failure leaves no profile/membership/config rows", (await count("seller_memberships", "user_id", [rollbackSellerUser])) === 0);

    const rollbackProfileUser = await createUser(authRepository);
    const trackingProfileSeller = new TrackingSellerRepository();
    add("Profile failure rolls back Seller creation", await expectsError(
      () => service({ sellerRepository: trackingProfileSeller, profileRepository: new FailingProfileRepository() }).createWorkspace({ userId: rollbackProfileUser, storeName: "Profile Failure" }),
      (error) => error instanceof Error,
    ));
    const profileFailureSeller = trackingProfileSeller.createdSellerIds[0] ?? "";
    add("Profile failure leaves no Seller/profile/membership/config rows", profileFailureSeller !== "" && (await workspaceCounts(rollbackProfileUser, profileFailureSeller)).sellers === 0 && (await workspaceCounts(rollbackProfileUser, profileFailureSeller)).profiles === 0 && (await workspaceCounts(rollbackProfileUser, profileFailureSeller)).memberships === 0 && (await workspaceCounts(rollbackProfileUser, profileFailureSeller)).configs === 0);

    const rollbackMembershipUser = await createUser(authRepository);
    const trackingMembershipSeller = new TrackingSellerRepository();
    add("OWNER membership failure rolls back Seller/profile", await expectsError(
      () => service({
        sellerRepository: trackingMembershipSeller,
        authRepository: new FailingAuthRepository(),
      }).createWorkspace({ userId: rollbackMembershipUser, storeName: "Membership Failure" }),
      (error) => error instanceof Error,
    ));
    const membershipFailureSeller = trackingMembershipSeller.createdSellerIds[0] ?? "";
    add("OWNER membership failure leaves no Seller/profile/membership/config rows", membershipFailureSeller !== "" && (await workspaceCounts(rollbackMembershipUser, membershipFailureSeller)).sellers === 0 && (await workspaceCounts(rollbackMembershipUser, membershipFailureSeller)).profiles === 0 && (await workspaceCounts(rollbackMembershipUser, membershipFailureSeller)).memberships === 0 && (await workspaceCounts(rollbackMembershipUser, membershipFailureSeller)).configs === 0);

    const rollbackConfigUser = await createUser(authRepository);
    const trackingConfigSeller = new TrackingSellerRepository();
    add("Default config failure rolls back everything", await expectsError(
      () => service({
        sellerRepository: trackingConfigSeller,
        conversationConfigRepository: new FailingConversationConfigRepository(),
      }).createWorkspace({ userId: rollbackConfigUser, storeName: "Config Failure" }),
      (error) => error instanceof Error,
    ));
    const configFailureSeller = trackingConfigSeller.createdSellerIds[0] ?? "";
    add("Default config failure leaves no Seller/profile/membership/config rows", configFailureSeller !== "" && (await workspaceCounts(rollbackConfigUser, configFailureSeller)).sellers === 0 && (await workspaceCounts(rollbackConfigUser, configFailureSeller)).profiles === 0 && (await workspaceCounts(rollbackConfigUser, configFailureSeller)).memberships === 0 && (await workspaceCounts(rollbackConfigUser, configFailureSeller)).configs === 0);

    const allTrackedSellerIds = sellerIds.filter((sellerId) => sellerId.startsWith("seller_"));
    add("No orphan profile rows exist for Phase 10B sellers", (await count("seller_workspace_profiles", "seller_id", allTrackedSellerIds)) <= (await count("sellers", "seller_id", allTrackedSellerIds)));
  } finally {
    await cleanup();
    const remainingUsers = await count("auth_users", "user_id", userIds);
    const remainingSellers = await count("sellers", "seller_id", sellerIds);
    const remainingProfiles = await count("seller_workspace_profiles", "seller_id", sellerIds);
    const remainingMemberships = await count("seller_memberships", "seller_id", sellerIds);
    const remainingConfigs = await count("seller_conversation_configs", "seller_id", sellerIds);
    add("Only Phase 10B test records are cleaned up", remainingUsers === 0 && remainingSellers === 0 && remainingProfiles === 0 && remainingMemberships === 0 && remainingConfigs === 0);
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
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 10B workspace creation test failed safely." })}\n`);
  process.exitCode = 1;
});
