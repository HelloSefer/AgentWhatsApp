import { withTransaction } from "../../infrastructure/database";

export class DevelopmentTenantDesignationError extends Error {
  constructor(readonly code: "DESIGNATION_DISABLED" | "ELIGIBLE_CONNECTION_NOT_UNIQUE" | "DEVELOPMENT_TENANT_CONFLICT") { super(code); this.name = "DevelopmentTenantDesignationError"; }
}

type EligibleRow = Readonly<{ seller_id: string; workspace_purpose: "STANDARD" | "DEVELOPMENT" }>;

export class DevelopmentTenantDesignationService {
  async designate(): Promise<Readonly<{ status: "DESIGNATED" | "ALREADY_DESIGNATED" }>> {
    if ((process.env.NODE_ENV || "development").trim().toLowerCase() === "production" || process.env.AGENTWHATSAPP_DEVELOPMENT_DESIGNATE !== "true") {
      throw new DevelopmentTenantDesignationError("DESIGNATION_DISABLED");
    }
    try {
      return await withTransaction(async (transaction) => {
        const eligible = await transaction.execute<EligibleRow>({ text: `
          SELECT s.seller_id, s.workspace_purpose
          FROM whatsapp_connections c
          INNER JOIN sellers s ON s.seller_id = c.seller_id
          WHERE c.status = 'ACTIVE' AND c.connection_method = 'CUSTOMER_OWNED_META_APP'
          ORDER BY s.seller_id ASC
          FOR UPDATE OF c, s
        `, values: [] });
        if (eligible.rows.length !== 1) throw new DevelopmentTenantDesignationError("ELIGIBLE_CONNECTION_NOT_UNIQUE");
        const current = eligible.rows[0]!;
        if (current.workspace_purpose === "DEVELOPMENT") return { status: "ALREADY_DESIGNATED" };
        const existing = await transaction.execute<{ seller_id: string }>({ text: "SELECT seller_id FROM sellers WHERE workspace_purpose = 'DEVELOPMENT' FOR UPDATE", values: [] });
        if (existing.rows.length !== 0) throw new DevelopmentTenantDesignationError("DEVELOPMENT_TENANT_CONFLICT");
        await transaction.execute({ text: "UPDATE sellers SET workspace_purpose = 'DEVELOPMENT', updated_at = NOW() WHERE seller_id = $1", values: [current.seller_id] });
        return { status: "DESIGNATED" };
      });
    } catch (error) {
      if (error instanceof DevelopmentTenantDesignationError) throw error;
      throw new DevelopmentTenantDesignationError("DEVELOPMENT_TENANT_CONFLICT");
    }
  }
}
