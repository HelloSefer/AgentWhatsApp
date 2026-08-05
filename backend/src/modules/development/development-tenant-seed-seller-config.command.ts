import dotenv from "dotenv";
import { closeDatabasePool, createTenantContext } from "../../infrastructure/database";
import { DevelopmentTenantService } from "./development-tenant.service";
import { buildSandalsDevelopmentSellerConfig } from "./sandals-development-template";
import { sellerCommerceConfigRepository } from "../seller-commerce-config";
import { canonicalSellerCommerceConfigFromLegacy } from "../seller-commerce-config/seller-commerce-config.mapper";
dotenv.config();
async function main(): Promise<void> {
  if ((process.env.NODE_ENV || "development").toLowerCase() === "production" || process.env.AGENTWHATSAPP_DEVELOPMENT_SEED !== "true") throw new Error("DEVELOPMENT_SEED_DISABLED");
  try { const tenant = await new DevelopmentTenantService().resolveCurrent(); const config = canonicalSellerCommerceConfigFromLegacy(buildSandalsDevelopmentSellerConfig(tenant.sellerId)); await sellerCommerceConfigRepository.save(createTenantContext(tenant.sellerId), config); console.log(JSON.stringify({ command: "development-tenant:seed-seller-config", status: "SEEDED", configVersion: config.configVersion })); }
  finally { delete process.env.AGENTWHATSAPP_DEVELOPMENT_SEED; await closeDatabasePool(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Development seed failed."); process.exitCode = 1; });
