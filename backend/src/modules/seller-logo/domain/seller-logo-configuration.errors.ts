export class SellerLogoStorageConfigurationError extends Error {
  constructor() {
    super("Seller logo storage configuration is invalid.");
    this.name = "SellerLogoStorageConfigurationError";
  }
}
