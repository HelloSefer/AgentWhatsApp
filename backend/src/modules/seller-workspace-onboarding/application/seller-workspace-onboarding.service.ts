import { randomUUID } from "node:crypto";
import { createTenantContext, type DatabaseTransactionExecutor, withTransaction } from "../../../infrastructure/database";
import type { AuthRepositories } from "../../auth";
import { AuthAlreadyExistsError, AuthValidationError } from "../../auth";
import type { SellerMembership } from "../../auth/domain/auth.types";
import type { ConversationConfigRepository } from "../../conversation-config";
import type { PersistedConversationConfig } from "../../conversation-config/domain/persisted-conversation-config.types";
import type { ConversationConfigurationOverride } from "../../conversation-engine";
import type { SellerRepository } from "../../seller";
import { SellerAlreadyExistsError, SellerValidationError, validateSellerId } from "../../seller";
import type { SellerWorkspaceProfileRepository, SellerWorkspaceProfile } from "../../seller-workspace-profile";
import {
  normalizeIntendedWhatsappPhoneE164,
  normalizeWorkspaceDisplayName,
} from "../../seller-workspace-profile";
import {
  SellerWorkspaceOnboardingInactiveUserError,
  SellerWorkspaceOnboardingInconsistentStateError,
  SellerWorkspaceOnboardingPersistenceError,
  SellerWorkspaceOnboardingUserNotFoundError,
  SellerWorkspaceOnboardingValidationError,
} from "../domain/seller-workspace-onboarding.errors";

const DEFAULT_SELLER_CONVERSATION_CONFIG: ConversationConfigurationOverride = Object.freeze({
  schemaVersion: 1,
});

const MAX_SELLER_ID_ATTEMPTS = 8;

export type CreateSellerWorkspaceInput = Readonly<{
  userId: string;
  storeName: string;
  intendedWhatsAppPhone?: string | null;
}>;

export type SellerWorkspaceCreationStatus = "created" | "existing";

export type SellerWorkspaceCreationResult = Readonly<{
  status: SellerWorkspaceCreationStatus;
  sellerId: string;
  profile: SellerWorkspaceProfile;
  ownerMembership: SellerMembership;
  defaultConversationConfig: PersistedConversationConfig;
}>;

export type SellerWorkspaceOnboardingServiceDependencies = Readonly<{
  authRepository: AuthRepositories;
  sellerRepository: SellerRepository;
  profileRepository: SellerWorkspaceProfileRepository;
  conversationConfigRepository: ConversationConfigRepository;
}>;

function validateTrustedUserId(value: unknown): string {
  if (typeof value !== "string") throw new SellerWorkspaceOnboardingValidationError();
  const userId = value.trim();
  if (!userId || userId.length > 128) throw new SellerWorkspaceOnboardingValidationError();
  return userId;
}

function generatedSellerId(): string {
  return `seller_${randomUUID().replace(/-/gu, "")}`;
}

function activeMemberships(memberships: readonly SellerMembership[]): readonly SellerMembership[] {
  return memberships.filter((membership) => membership.status === "active");
}

function mapBoundaryValidation(error: unknown): never {
  if (
    error instanceof SellerWorkspaceOnboardingValidationError ||
    error instanceof SellerWorkspaceOnboardingInactiveUserError ||
    error instanceof SellerWorkspaceOnboardingUserNotFoundError ||
    error instanceof SellerWorkspaceOnboardingInconsistentStateError
  ) throw error;
  if (error instanceof SellerValidationError || error instanceof AuthValidationError) {
    throw new SellerWorkspaceOnboardingValidationError();
  }
  throw new SellerWorkspaceOnboardingPersistenceError(error);
}

export class SellerWorkspaceOnboardingService {
  constructor(private readonly dependencies: SellerWorkspaceOnboardingServiceDependencies) {}

  async needsOnboarding(userId: string): Promise<boolean> {
    try {
      const memberships = await this.dependencies.authRepository.listSellerMembershipsForUser(validateTrustedUserId(userId));
      return activeMemberships(memberships).length === 0;
    } catch (error) {
      mapBoundaryValidation(error);
    }
  }

  async createWorkspace(input: CreateSellerWorkspaceInput): Promise<SellerWorkspaceCreationResult> {
    const userId = validateTrustedUserId(input.userId);
    const displayName = normalizeWorkspaceDisplayName(input.storeName);
    const intendedPhone = normalizeIntendedWhatsappPhoneE164(input.intendedWhatsAppPhone);

    try {
      return await withTransaction(async (transaction) => {
        const options = { executor: transaction };
        const user = await this.dependencies.authRepository.lockUserForOnboarding(userId, options);
        if (!user) throw new SellerWorkspaceOnboardingUserNotFoundError();
        if (user.status !== "active") throw new SellerWorkspaceOnboardingInactiveUserError();

        const currentActiveMemberships = activeMemberships(await this.dependencies.authRepository.listSellerMembershipsForUser(userId, options));
        if (currentActiveMemberships.length > 0) {
          return this.existingWorkspace(currentActiveMemberships, transaction);
        }

        return this.createNewWorkspace({ userId, displayName, intendedPhone, transaction });
      });
    } catch (error) {
      mapBoundaryValidation(error);
    }
  }

  private async existingWorkspace(
    currentActiveMemberships: readonly SellerMembership[],
    transaction: DatabaseTransactionExecutor,
  ): Promise<SellerWorkspaceCreationResult> {
    if (currentActiveMemberships.length !== 1) throw new SellerWorkspaceOnboardingInconsistentStateError();
    const ownerMembership = currentActiveMemberships[0];
    if (!ownerMembership || ownerMembership.role !== "OWNER") throw new SellerWorkspaceOnboardingInconsistentStateError();

    const tenant = createTenantContext(ownerMembership.sellerId);
    const options = { executor: transaction };
    const [profile, defaultConversationConfig] = await Promise.all([
      this.dependencies.profileRepository.findByTenantContext(tenant, options),
      this.dependencies.conversationConfigRepository.getSellerOverride(tenant, options),
    ]);
    if (!profile || !defaultConversationConfig) throw new SellerWorkspaceOnboardingInconsistentStateError();
    return {
      status: "existing",
      sellerId: ownerMembership.sellerId,
      profile,
      ownerMembership,
      defaultConversationConfig,
    };
  }

  private async createNewWorkspace(input: Readonly<{
    userId: string;
    displayName: string;
    intendedPhone?: string;
    transaction: DatabaseTransactionExecutor;
  }>): Promise<SellerWorkspaceCreationResult> {
    const options = { executor: input.transaction };
    for (let attempt = 0; attempt < MAX_SELLER_ID_ATTEMPTS; attempt += 1) {
      const sellerId = generatedSellerId();
      try {
        await this.dependencies.sellerRepository.create({ sellerId: validateSellerId(sellerId) }, options);
        const tenant = createTenantContext(sellerId);
        const profile = await this.dependencies.profileRepository.createProfile({
          sellerId,
          displayName: input.displayName,
          intendedWhatsappPhoneE164: input.intendedPhone,
        }, options);
        const ownerMembership = await this.dependencies.authRepository.createSellerMembership({
          sellerId,
          userId: input.userId,
          role: "OWNER",
          status: "active",
        }, options);
        const defaultConversationConfig = await this.dependencies.conversationConfigRepository.saveSellerOverride(
          tenant,
          DEFAULT_SELLER_CONVERSATION_CONFIG,
          options,
        );

        return {
          status: "created",
          sellerId,
          profile,
          ownerMembership,
          defaultConversationConfig,
        };
      } catch (error) {
        if (error instanceof SellerAlreadyExistsError) continue;
        if (error instanceof AuthAlreadyExistsError) throw new SellerWorkspaceOnboardingInconsistentStateError();
        throw error;
      }
    }

    throw new SellerWorkspaceOnboardingPersistenceError();
  }
}
