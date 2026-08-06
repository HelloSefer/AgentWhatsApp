import { createPersistenceComposition } from "../persistence/create-persistence-composition";
import type { PersistenceComposition } from "../persistence/persistence-composition.types";
import { RuntimeCatalogReader } from "./runtime-catalog-reader";
import { RuntimeConversationConfigReader } from "./runtime-conversation-config-reader";
import { resolveRuntimeReadMode, type RuntimeReadMode } from "./runtime-read-mode";
import { SellerCommerceConfigRuntimeReader, SellerCommerceConfigRepository } from "../../modules/seller-commerce-config";
import { SellerCommerceRuntimeProjectionReader } from "./seller-commerce-runtime-projection";
import { PostgreSqlWhatsAppConnectionRepository } from "../../modules/whatsapp-connection";

export type RuntimeReadComposition = Readonly<{
  catalogReader: RuntimeCatalogReader;
  conversationConfigReader: RuntimeConversationConfigReader;
  sellerCommerceProjectionReader: SellerCommerceRuntimeProjectionReader;
}>;

export function createRuntimeReadComposition(input: Readonly<{
  mode?: RuntimeReadMode;
  persistence?: PersistenceComposition;
}> = {}): RuntimeReadComposition {
  const persistence = input.persistence || createPersistenceComposition();
  const mode = input.mode || resolveRuntimeReadMode(process.env.PERSISTENCE_RUNTIME_READS_ENABLED);
  return Object.freeze({
    catalogReader: new RuntimeCatalogReader(persistence.catalogService, mode),
    conversationConfigReader: new RuntimeConversationConfigReader(persistence.conversationConfigService, mode),
    sellerCommerceProjectionReader: new SellerCommerceRuntimeProjectionReader({ commerceConfigReader: new SellerCommerceConfigRuntimeReader(new SellerCommerceConfigRepository()), catalogService: persistence.catalogService, conversationConfigService: persistence.conversationConfigService, workspaceProfileRepository: persistence.sellerWorkspaceProfileRepository, whatsappConnectionRepository: new PostgreSqlWhatsAppConnectionRepository() }),
  });
}
