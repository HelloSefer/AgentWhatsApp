import { executeDatabaseQuery, type DatabaseQueryExecutor } from "../../infrastructure/database";

export type DevelopmentTenantStatus = "NOT_CONFIGURED" | "CONNECTION_REQUIRED" | "COMMERCE_REQUIRED" | "READY" | "DEGRADED";
export type DevelopmentTenantSafeResult = Readonly<{
  configured: boolean;
  workspacePurpose?: "DEVELOPMENT";
  connectionStatus?: string;
  connectionMethod?: string;
  commerceReadiness: "NOT_READY" | "READY";
  productCount: number;
  conversationConfigAvailable: boolean;
  encryptedCredentialSourceAvailable: boolean;
  receiptBrandingAvailable: boolean;
  runtimeReady: boolean;
  status: DevelopmentTenantStatus;
  blockers: readonly string[];
  lastVerifiedAt?: string;
}>;

export class DevelopmentTenantResolutionError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "AMBIGUOUS") { super(code); this.name = "DevelopmentTenantResolutionError"; }
}

type Row = Readonly<{
  seller_id: string; workspace_purpose: "DEVELOPMENT"; connection_status: string | null;
  connection_method: string | null; credential_available: boolean; product_count: string;
  conversation_config_available: boolean; receipt_branding_available: boolean; last_verified_at: Date | string | null;
}>;

export class DevelopmentTenantService {
  constructor(private readonly executor: DatabaseQueryExecutor = { execute: executeDatabaseQuery }) {}

  async resolveCurrent(): Promise<DevelopmentTenantSafeResult & Readonly<{ sellerId: string }>> {
    const result = await this.executor.execute<Row>({ text: `
      SELECT s.seller_id, s.workspace_purpose, c.status AS connection_status,
        c.connection_method, (c.encrypted_system_user_access_token IS NOT NULL) AS credential_available,
        (SELECT COUNT(*)::text FROM products p WHERE p.seller_id = s.seller_id) AS product_count,
        EXISTS(SELECT 1 FROM seller_conversation_configs sc WHERE sc.seller_id = s.seller_id) AS conversation_config_available,
        EXISTS(SELECT 1 FROM seller_workspace_profiles wp WHERE wp.seller_id = s.seller_id AND wp.logo_object_key IS NOT NULL) AS receipt_branding_available,
        c.last_verified_at
      FROM sellers s
      LEFT JOIN whatsapp_connections c ON c.seller_id = s.seller_id
        AND c.status = 'ACTIVE' AND c.connection_method = 'CUSTOMER_OWNED_META_APP'
      WHERE s.workspace_purpose = 'DEVELOPMENT'
      ORDER BY s.seller_id ASC
    `, values: [] });
    if (result.rows.length === 0) throw new DevelopmentTenantResolutionError("NOT_CONFIGURED");
    if (result.rows.length !== 1) throw new DevelopmentTenantResolutionError("AMBIGUOUS");
    const row = result.rows[0]!;
    const productCount = Number(row.product_count);
    const active = row.connection_status === "ACTIVE" && row.connection_method === "CUSTOMER_OWNED_META_APP";
    const commerceReady = productCount > 0 && row.conversation_config_available;
    const runtimeReady = active && row.credential_available && commerceReady;
    const blockers: string[] = [];
    if (!active) blockers.push("ACTIVE_CUSTOMER_OWNED_CONNECTION_REQUIRED");
    if (active && !row.credential_available) blockers.push("ENCRYPTED_CREDENTIAL_SOURCE_REQUIRED");
    if (productCount === 0) blockers.push("PRODUCT_CATALOG_REQUIRED");
    if (!row.conversation_config_available) blockers.push("CONVERSATION_CONFIG_REQUIRED");
    const status: DevelopmentTenantStatus = !active ? "CONNECTION_REQUIRED" : !commerceReady ? "COMMERCE_REQUIRED" : runtimeReady ? "READY" : "DEGRADED";
    return { sellerId: row.seller_id, configured: true, workspacePurpose: "DEVELOPMENT", connectionStatus: row.connection_status ?? undefined,
      connectionMethod: row.connection_method ?? undefined, commerceReadiness: commerceReady ? "READY" : "NOT_READY", productCount,
      conversationConfigAvailable: row.conversation_config_available, encryptedCredentialSourceAvailable: row.credential_available,
      receiptBrandingAvailable: row.receipt_branding_available, runtimeReady, status, blockers,
      ...(row.last_verified_at ? { lastVerifiedAt: new Date(row.last_verified_at).toISOString() } : {}) };
  }

  async getCurrent(): Promise<DevelopmentTenantSafeResult> {
    const { sellerId: _sellerId, ...safe } = await this.resolveCurrent();
    return safe;
  }

  async getReadiness(): Promise<DevelopmentTenantSafeResult> {
    try { return await this.getCurrent(); }
    catch (error) {
      if (error instanceof DevelopmentTenantResolutionError && error.code === "NOT_CONFIGURED") return {
        configured: false, commerceReadiness: "NOT_READY", productCount: 0, conversationConfigAvailable: false,
        encryptedCredentialSourceAvailable: false, receiptBrandingAvailable: false, runtimeReady: false,
        status: "NOT_CONFIGURED", blockers: ["DEVELOPMENT_TENANT_NOT_CONFIGURED"],
      };
      throw error;
    }
  }
}
