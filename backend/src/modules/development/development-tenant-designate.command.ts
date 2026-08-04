import dotenv from "dotenv";
import { closeDatabasePool } from "../../infrastructure/database";
import { DevelopmentTenantDesignationService } from "./development-tenant-designation.service";
dotenv.config();
async function main(): Promise<void> {
  try {
    const result = await new DevelopmentTenantDesignationService().designate();
    console.info(JSON.stringify({ event: "development_tenant_designated", designationStatus: result.status }));
    console.log(JSON.stringify({ command: "development-tenant:designate", designationStatus: result.status }, null, 2));
  } finally { delete process.env.AGENTWHATSAPP_DEVELOPMENT_DESIGNATE; await closeDatabasePool(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Development designation failed."); process.exitCode = 1; });
