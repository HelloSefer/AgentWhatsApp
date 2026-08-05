import { executeDatabaseQuery, type DatabaseQueryExecutor, type TenantContext } from "../../infrastructure/database";
import type { SellerCommerceConfigV1 } from "./seller-commerce-config.types";
import { parseSellerCommerceConfig } from "./seller-commerce-config.parser";

export type PersistedSellerCommerceConfig = Readonly<{ config: SellerCommerceConfigV1; createdAt: Date; updatedAt: Date }>;
export class SellerCommerceConfigRepository {
  constructor(private readonly executor: DatabaseQueryExecutor = { execute: executeDatabaseQuery }) {}
  async find(tenant: TenantContext): Promise<PersistedSellerCommerceConfig | null> {
    const result = await this.executor.execute<{ config_json: unknown; created_at: Date | string; updated_at: Date | string }>({ text: "SELECT config_json, created_at, updated_at FROM seller_commerce_configs WHERE seller_id = $1 LIMIT 1", values: [tenant.sellerId] });
    const row = result.rows[0]; if (!row) return null;
    return { config: parseSellerCommerceConfig(row.config_json), createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) };
  }
  async save(tenant: TenantContext, config: unknown): Promise<PersistedSellerCommerceConfig> {
    const parsed = parseSellerCommerceConfig(config);
    const result = await this.executor.execute<{ config_json: unknown; created_at: Date | string; updated_at: Date | string }>({ text: "INSERT INTO seller_commerce_configs (seller_id, config_json) VALUES ($1, $2::jsonb) ON CONFLICT (seller_id) DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = NOW() RETURNING config_json, created_at, updated_at", values: [tenant.sellerId, JSON.stringify(parsed)] });
    const row = result.rows[0]; if (!row) throw new Error("SELLER_COMMERCE_CONFIG_INVALID");
    return { config: parseSellerCommerceConfig(row.config_json), createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) };
  }
}
export const sellerCommerceConfigRepository = new SellerCommerceConfigRepository();
