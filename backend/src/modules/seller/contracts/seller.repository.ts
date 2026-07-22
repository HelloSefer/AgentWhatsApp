import type { TenantContext } from "../../../infrastructure/database";
import type { Seller, SellerId } from "../domain/seller";

export type CreateSellerInput = Readonly<{
  sellerId: SellerId;
}>;

export interface SellerRepository {
  create(input: CreateSellerInput): Promise<Seller>;
  findByTenantContext(tenant: TenantContext): Promise<Seller | null>;
  existsByTenantContext(tenant: TenantContext): Promise<boolean>;
}
