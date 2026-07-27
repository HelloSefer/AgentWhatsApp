import {
  ConfirmedOrderPersistenceService,
  PostgreSqlConfirmedOrderRepository,
} from "../../modules/agent/order/persistence";
import { CatalogService, PostgreSqlCatalogRepository } from "../../modules/catalog";
import {
  ConversationConfigService,
  PostgreSqlConversationConfigRepository,
} from "../../modules/conversation-config";
import { PostgreSqlAuthRepository } from "../../modules/auth";
import { PostgreSqlSellerRepository, SellerService } from "../../modules/seller";
import {
  createSellerLogoStorageFromConfiguration,
  SellerLogoService,
  validateSellerLogoStorageConfiguration,
  type SellerLogoStorage,
} from "../../modules/seller-logo";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../modules/seller-workspace-profile";
import { SellerWorkspaceOnboardingService } from "../../modules/seller-workspace-onboarding";
import { env } from "../../config/env";
import type { PersistenceComposition } from "./persistence-composition.types";

function createSellerLogoStorage(): SellerLogoStorage {
  const configuration = validateSellerLogoStorageConfiguration({
    provider: env.sellerLogoStorageProvider,
    endpoint: env.r2Endpoint,
    accessKeyId: env.r2AccessKeyId,
    secretAccessKey: env.r2SecretAccessKey,
    bucketName: env.r2BucketName,
  });

  return createSellerLogoStorageFromConfiguration(configuration);
}

/**
 * Builds persistence-backed application services without connecting to PostgreSQL.
 * Runtime composition remains explicit until a later integration phase opts into it.
 */
export function createPersistenceComposition(): PersistenceComposition {
  const sellerRepository = new PostgreSqlSellerRepository();
  const catalogRepository = new PostgreSqlCatalogRepository();
  const conversationConfigRepository = new PostgreSqlConversationConfigRepository();
  const confirmedOrderRepository = new PostgreSqlConfirmedOrderRepository();
  const sellerWorkspaceProfileRepository = new PostgreSqlSellerWorkspaceProfileRepository();
  const authRepository = new PostgreSqlAuthRepository();
  const sellerLogoStorage = createSellerLogoStorage();

  return Object.freeze({
    sellerService: new SellerService(sellerRepository),
    catalogService: new CatalogService(catalogRepository),
    conversationConfigService: new ConversationConfigService(conversationConfigRepository),
    confirmedOrderPersistenceService: new ConfirmedOrderPersistenceService(confirmedOrderRepository),
    sellerWorkspaceProfileRepository,
    sellerLogoService: new SellerLogoService({
      storage: sellerLogoStorage,
      profileRepository: sellerWorkspaceProfileRepository,
    }),
    sellerWorkspaceOnboardingService: new SellerWorkspaceOnboardingService({
      authRepository,
      sellerRepository,
      profileRepository: sellerWorkspaceProfileRepository,
      conversationConfigRepository,
    }),
  });
}
