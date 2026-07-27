import type { DatabaseQueryExecutor, TenantContext } from "../../../infrastructure/database";
import type { Seller, SellerId } from "../domain/seller";

export type SellerRepositoryOptions = Readonly<{
  executor?: DatabaseQueryExecutor;
}>;

export type CreateSellerInput = Readonly<{
  sellerId: SellerId;
}>;

export interface SellerRepository {
  create(input: CreateSellerInput, options?: SellerRepositoryOptions): Promise<Seller>;
  findByTenantContext(tenant: TenantContext, options?: SellerRepositoryOptions): Promise<Seller | null>;
  existsByTenantContext(tenant: TenantContext, options?: SellerRepositoryOptions): Promise<boolean>;
}
