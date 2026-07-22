import {
  ConfirmedOrderPersistenceService,
  PostgreSqlConfirmedOrderRepository,
} from "../../modules/agent/order/persistence";
import { CatalogService, PostgreSqlCatalogRepository } from "../../modules/catalog";
import {
  ConversationConfigService,
  PostgreSqlConversationConfigRepository,
} from "../../modules/conversation-config";
import { PostgreSqlSellerRepository, SellerService } from "../../modules/seller";
import type { PersistenceComposition } from "./persistence-composition.types";

/**
 * Builds persistence-backed application services without connecting to PostgreSQL.
 * Runtime composition remains explicit until a later integration phase opts into it.
 */
export function createPersistenceComposition(): PersistenceComposition {
  const sellerRepository = new PostgreSqlSellerRepository();
  const catalogRepository = new PostgreSqlCatalogRepository();
  const conversationConfigRepository = new PostgreSqlConversationConfigRepository();
  const confirmedOrderRepository = new PostgreSqlConfirmedOrderRepository();

  return Object.freeze({
    sellerService: new SellerService(sellerRepository),
    catalogService: new CatalogService(catalogRepository),
    conversationConfigService: new ConversationConfigService(conversationConfigRepository),
    confirmedOrderPersistenceService: new ConfirmedOrderPersistenceService(confirmedOrderRepository),
  });
}
