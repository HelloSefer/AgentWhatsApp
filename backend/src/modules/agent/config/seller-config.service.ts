import { DEFAULT_DEMO_SELLER_ID } from "../identity/seller-resolver.service";
import { demoSellerConfigs } from "./demo-seller-configs";
import type { SellerConfig } from "./seller-config.types";

export type SellerConfigLookupResult = {
  sellerConfig: SellerConfig;
  requestedSellerId: string;
  fallbackUsed: boolean;
};

export class SellerConfigService {
  getSellerConfig(sellerId: string): SellerConfig {
    return this.getSellerConfigWithMeta(sellerId).sellerConfig;
  }

  getSellerConfigWithMeta(sellerId: string): SellerConfigLookupResult {
    const cleanSellerId = sellerId.trim();
    const sellerConfig = demoSellerConfigs.find(
      (config) => config.sellerId === cleanSellerId,
    );

    if (sellerConfig) {
      return {
        sellerConfig,
        requestedSellerId: cleanSellerId,
        fallbackUsed: false,
      };
    }

    console.warn(
      `⚠️ Seller config not found for ${cleanSellerId || "(empty)"}, using ${DEFAULT_DEMO_SELLER_ID}`,
    );

    return {
      sellerConfig:
        demoSellerConfigs.find(
          (config) => config.sellerId === DEFAULT_DEMO_SELLER_ID,
        ) || demoSellerConfigs[0],
      requestedSellerId: cleanSellerId,
      fallbackUsed: true,
    };
  }

  listDemoSellerConfigs(): SellerConfig[] {
    return [...demoSellerConfigs];
  }

  hasSellerConfig(sellerId: string): boolean {
    const cleanSellerId = sellerId.trim();

    return demoSellerConfigs.some((config) => config.sellerId === cleanSellerId);
  }
}

export const sellerConfigService = new SellerConfigService();
