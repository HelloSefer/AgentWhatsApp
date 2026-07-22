import { SellerValidationError } from "./seller.errors";

declare const sellerIdBrand: unique symbol;

export type SellerId = string & Readonly<{ [sellerIdBrand]: "SellerId" }>;

export type Seller = Readonly<{
  sellerId: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export const SELLER_ID_MAX_LENGTH = 128;

function normalizedSellerId(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, "-");
}

export function validateSellerId(value: unknown): SellerId {
  if (typeof value !== "string") throw new SellerValidationError();

  const sellerId = value.trim();
  if (
    !sellerId ||
    sellerId.length > SELLER_ID_MAX_LENGTH ||
    normalizedSellerId(sellerId) === "default-seller"
  ) {
    throw new SellerValidationError();
  }

  return sellerId as SellerId;
}
