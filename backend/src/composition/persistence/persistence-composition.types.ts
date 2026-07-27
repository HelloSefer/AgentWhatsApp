import type { ConfirmedOrderPersistenceService } from "../../modules/agent/order/persistence";
import type { CatalogService } from "../../modules/catalog";
import type { ConversationConfigService } from "../../modules/conversation-config";
import type { SellerService } from "../../modules/seller";
import type { SellerWorkspaceProfileRepository } from "../../modules/seller-workspace-profile";

export type PersistenceComposition = Readonly<{
  sellerService: SellerService;
  catalogService: CatalogService;
  conversationConfigService: ConversationConfigService;
  confirmedOrderPersistenceService: ConfirmedOrderPersistenceService;
  sellerWorkspaceProfileRepository: SellerWorkspaceProfileRepository;
}>;
