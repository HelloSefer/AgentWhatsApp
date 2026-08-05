import { createTenantContext } from "../../infrastructure/database";
import { SellerCommerceConfigRepository } from "./seller-commerce-config.repository";
import type { SellerCommerceConfigV1 } from "./seller-commerce-config.types";
import { parseSellerCommerceConfig } from "./seller-commerce-config.parser";

export type SellerCommerceConfigResolution = Readonly<{ status: "READY"; config: SellerCommerceConfigV1 } | { status: "SELLER_COMMERCE_CONFIG_REQUIRED" } | { status: "SELLER_COMMERCE_CONFIG_INVALID" }>;
export class SellerCommerceConfigRuntimeReader {
  constructor(private readonly repository = new SellerCommerceConfigRepository()) {}
  async resolve(sellerId: string): Promise<SellerCommerceConfigResolution> {
    try { const config = await this.repository.find(createTenantContext(sellerId)); return config ? { status: "READY", config: parseSellerCommerceConfig(config.config) } : { status: "SELLER_COMMERCE_CONFIG_REQUIRED" }; }
    catch { return { status: "SELLER_COMMERCE_CONFIG_INVALID" }; }
  }
}
