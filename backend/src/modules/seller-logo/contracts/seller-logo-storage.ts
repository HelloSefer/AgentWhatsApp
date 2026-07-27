import type { SellerLogoMetadata, SellerLogoMimeType } from "../domain/seller-logo.types";

export type StoreSellerLogoInput = Readonly<{
  objectKey: string;
  bytes: Buffer;
  mimeType: SellerLogoMimeType;
}>;

export interface SellerLogoStorage {
  store(input: StoreSellerLogoInput): Promise<SellerLogoMetadata>;
  delete(objectKey: string): Promise<void>;
}
