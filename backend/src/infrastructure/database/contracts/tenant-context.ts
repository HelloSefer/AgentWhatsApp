import { InvalidTenantContextError } from "../errors/database.errors";

export type TenantContext = Readonly<{
  sellerId: string;
}>;

function normalizedSellerId(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, "-");
}

export function createTenantContext(sellerId: unknown): TenantContext {
  if (typeof sellerId !== "string") {
    throw new InvalidTenantContextError();
  }

  const trimmedSellerId = sellerId.trim();
  if (!trimmedSellerId || normalizedSellerId(trimmedSellerId) === "default-seller") {
    throw new InvalidTenantContextError();
  }

  return { sellerId: trimmedSellerId };
}
