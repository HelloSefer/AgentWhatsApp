import dotenv from "dotenv";
import { closeDatabasePool } from "../../infrastructure/database";
import { closeValkeyClient, getValkeyClient } from "../../infrastructure/valkey/valkey.client";
import { DevelopmentTenantConversationResetService } from "./development-tenant-conversation-reset.service";
import { DevelopmentTenantService } from "./development-tenant.service";
dotenv.config();
async function main(): Promise<void> {
  const nodeEnv = (process.env.NODE_ENV || "development").trim().toLowerCase();
  if (nodeEnv === "production" || process.env.AGENTWHATSAPP_DEVELOPMENT_RESET !== "true") {
    throw new Error("DEVELOPMENT_RESET_DISABLED");
  }
  try {
    const result = await new DevelopmentTenantConversationResetService(new DevelopmentTenantService(), getValkeyClient()).executeTrustedReset();
    console.log(JSON.stringify({ command: "demo:sandals:conversation-reset", deletedEphemeralKeyCount: result.deletedKeyCount }, null, 2));
  } finally { delete process.env.AGENTWHATSAPP_DEVELOPMENT_RESET; await closeValkeyClient(); await closeDatabasePool(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Development reset failed."); process.exitCode = 1; });
