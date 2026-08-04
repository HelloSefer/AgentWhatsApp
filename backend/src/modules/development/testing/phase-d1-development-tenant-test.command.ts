import { readFile } from "node:fs/promises";
import type { DatabaseQueryExecutor, ParameterizedQuery } from "../../../infrastructure/database";
import { DevelopmentTenantConversationResetService } from "../development-tenant-conversation-reset.service";
import { DevelopmentTenantResolutionError, DevelopmentTenantService } from "../development-tenant.service";

type Row = Record<string, unknown>;
class FakeExecutor implements DatabaseQueryExecutor {
  constructor(private readonly rows: readonly Row[]) {}
  async execute<T>(_: ParameterizedQuery): Promise<{ rows: T[]; rowCount: number }> { return { rows: this.rows as T[], rowCount: this.rows.length }; }
}
const row = (overrides: Partial<Row> = {}): Row => ({ seller_id: "tenant-a", workspace_purpose: "DEVELOPMENT", connection_status: "ACTIVE", connection_method: "CUSTOMER_OWNED_META_APP", credential_available: true, product_count: "2", conversation_config_available: true, receipt_branding_available: true, last_verified_at: "2026-08-01T00:00:00.000Z", ...overrides });
async function main(): Promise<void> {
  const results: string[] = []; const add = (name: string, pass: boolean) => { if (!pass) throw new Error(`FAIL: ${name}`); results.push(name); };
  const ready = await new DevelopmentTenantService(new FakeExecutor([row()])).resolveCurrent();
  add("exactly one persisted DEVELOPMENT tenant resolves", ready.sellerId === "tenant-a" && ready.status === "READY");
  add("connection and commerce metadata are bounded", ready.connectionMethod === "CUSTOMER_OWNED_META_APP" && ready.productCount === 2 && !("phoneNumberId" in ready));
  const noTenant = await new DevelopmentTenantService(new FakeExecutor([])).getReadiness(); add("zero tenant reports NOT_CONFIGURED", noTenant.status === "NOT_CONFIGURED");
  try { await new DevelopmentTenantService(new FakeExecutor([row(), row({ seller_id: "tenant-b" })])).resolveCurrent(); add("multiple tenant fails closed", false); } catch (error) { add("multiple tenant fails closed", error instanceof DevelopmentTenantResolutionError && error.code === "AMBIGUOUS"); }
  const connectionRequired = await new DevelopmentTenantService(new FakeExecutor([row({ connection_status: null, connection_method: null, credential_available: false })])).getReadiness(); add("missing active customer-owned connection blocks readiness", connectionRequired.status === "CONNECTION_REQUIRED");
  const commerceRequired = await new DevelopmentTenantService(new FakeExecutor([row({ product_count: "0", conversation_config_available: false })])).getReadiness(); add("missing commerce blocks readiness", commerceRequired.status === "COMMERCE_REQUIRED");
  const scans: string[] = []; const deleted: string[][] = [];
  const valkey = { scan: async (_cursor: string, _match: string, pattern: string) => { scans.push(pattern); return ["0", pattern.startsWith("session") ? ["session:tenant-a:customer"] : pattern.startsWith("buffer") ? ["buffer:tenant-a:customer"] : ["lock:tenant-a:customer"]] as [string, string[]]; }, del: async (...keys: string[]) => { deleted.push(keys); return keys.length; } };
  const previousEnv = process.env.NODE_ENV; process.env.NODE_ENV = "test";
  const reset = new DevelopmentTenantConversationResetService(new DevelopmentTenantService(new FakeExecutor([row()])), valkey as never);
  const resetResult = await reset.executeTrustedReset(); add("reset scans only explicit tenant conversational prefixes", scans.every((value) => value.endsWith(":tenant-a:*")) && scans.length === 3);
  add("reset deletes only discovered ephemeral tenant keys", resetResult.deletedKeyCount === 3 && deleted.flat().every((key) => /^(session|buffer|lock):tenant-a:/.test(key)));
  add("shared executor does not read CLI authorization flags", !/AGENTWHATSAPP_DEVELOPMENT_RESET|NODE_ENV/.test(await readFile("src/modules/development/development-tenant-conversation-reset.service.ts", "utf8")));
  if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
  const [migration, service, resetSource, cliSource, routeSource] = await Promise.all([
    readFile("src/infrastructure/database/migrations/sql/0014_add_development_workspace_purpose.sql", "utf8"), readFile("src/modules/development/development-tenant.service.ts", "utf8"), readFile("src/modules/development/development-tenant-conversation-reset.service.ts", "utf8"), readFile("src/modules/development/development-tenant-conversation-reset.command.ts", "utf8"), readFile("src/modules/development/development-tenant.routes.ts", "utf8"),
  ]);
  add("STANDARD default and one-development constraint are persisted", migration.includes("DEFAULT 'STANDARD'") && migration.includes("sellers_one_development_workspace_idx"));
  add("resolution never uses phone, demo fallback, smoke, or environment token", !/phoneNumberId|seller_demo_sandals|FIRST_ENTRY_LIVE_SMOKE|WHATSAPP_CLOUD_ACCESS_TOKEN/.test(service));
  add("reset has no broad deletion", !/FLUSHDB|\*\*/.test(resetSource));
  add("CLI retains explicit environment authorization", cliSource.includes("AGENTWHATSAPP_DEVELOPMENT_RESET") && cliSource.includes('nodeEnv === "production"'));
  add("HTTP reset uses authenticated route policy rather than CLI flag", !routeSource.includes("AGENTWHATSAPP_DEVELOPMENT_RESET") && routeSource.includes("development_tenant_reset") && routeSource.includes("RESET_COMPLETED"));
  console.log(`Phase D1 development tenant tests passed: ${results.length}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
