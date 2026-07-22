import type { TenantContext } from "../../../infrastructure/database";
import type { SellerRepository } from "../contracts/seller.repository";
import type { Seller } from "../domain/seller";
import { validateSellerId } from "../domain/seller";

export class SellerService {
  constructor(private readonly repository: SellerRepository) {}

  async createSeller(sellerId: unknown): Promise<Seller> {
    return this.repository.create({ sellerId: validateSellerId(sellerId) });
  }

  async getSeller(tenant: TenantContext): Promise<Seller | null> {
    return this.repository.findByTenantContext(tenant);
  }

  async sellerExists(tenant: TenantContext): Promise<boolean> {
    return this.repository.existsByTenantContext(tenant);
  }
}
