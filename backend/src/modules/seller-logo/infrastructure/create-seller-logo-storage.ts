import type { SellerLogoStorageConfiguration } from "../config/seller-logo-storage.config";
import type { SellerLogoStorage } from "../contracts/seller-logo-storage";
import { LocalSellerLogoStorageAdapter } from "./local/local-seller-logo-storage.adapter";
import { CloudflareR2SellerLogoStorageAdapter } from "./r2/cloudflare-r2-seller-logo-storage.adapter";

export function createSellerLogoStorageFromConfiguration(
  configuration: SellerLogoStorageConfiguration,
): SellerLogoStorage {
  if (configuration.provider === "local") return new LocalSellerLogoStorageAdapter();
  return new CloudflareR2SellerLogoStorageAdapter(configuration);
}
