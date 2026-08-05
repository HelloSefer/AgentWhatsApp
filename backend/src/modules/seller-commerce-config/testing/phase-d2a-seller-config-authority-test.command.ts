import { readFile } from "node:fs/promises";
import { SellerCommerceConfigRuntimeReader } from "../seller-commerce-config-runtime-reader";
import { parseSellerCommerceConfig } from "../seller-commerce-config.parser";
async function main(): Promise<void> {
  const results: string[] = []; const add = (name: string, pass: boolean) => { if (!pass) throw new Error(`FAIL: ${name}`); results.push(name); };
  const config = parseSellerCommerceConfig({ configVersion: 1, payment: { method: "COD", enabled: true }, delivery: { enabled: true, availability: "all_cities", pricing: { mode: "ALL_FREE", currency: "MAD" } }, requiredCustomerFields: [{ key: "fullName", label: "Name", required: true, enabled: true }], orderBehavior: { multiItemOrderFlow: { enabled: true, runtimeMode: "guarded", allowedSellerIds: ["tenant-a"] } }, receipt: { enabled: true, sendAfterConfirmation: true } });
  const ready = await new SellerCommerceConfigRuntimeReader({ find: async () => ({ config }) } as never).resolve("tenant-a");
  add("canonical v1 parses and resolves", ready.status === "READY" && ready.config.configVersion === 1);
  add("identity and products are rejected", (() => { try { parseSellerCommerceConfig({ ...config, businessName: "no" }); return false; } catch { return true; } })());
  add("malformed minor unit money fails closed", (() => { try { parseSellerCommerceConfig({ ...config, delivery: { ...config.delivery, pricing: { mode: "FLAT_RATE", currency: "MAD", flatRateMinor: 1.1 } } }); return false; } catch { return true; } })());
  const missing = await new SellerCommerceConfigRuntimeReader({ find: async () => null } as never).resolve("tenant-a"); add("missing config is bounded", missing.status === "SELLER_COMMERCE_CONFIG_REQUIRED");
  const invalid = await new SellerCommerceConfigRuntimeReader({ find: async () => { throw new Error(); } } as never).resolve("tenant-a"); add("invalid config is bounded", invalid.status === "SELLER_COMMERCE_CONFIG_INVALID");
  const [migration, seed, reader] = await Promise.all([readFile("src/infrastructure/database/migrations/sql/0015_create_seller_commerce_configs.sql", "utf8"), readFile("src/modules/development/development-tenant-seed-seller-config.command.ts", "utf8"), readFile("src/modules/seller-commerce-config/seller-commerce-config-runtime-reader.ts", "utf8")]);
  add("persistence is seller-scoped", migration.includes("seller_id VARCHAR(128) PRIMARY KEY") && migration.includes("REFERENCES sellers"));
  add("seed remains explicitly development-authorized", seed.includes("AGENTWHATSAPP_DEVELOPMENT_SEED") && seed.includes("resolveCurrent"));
  add("runtime reader has no template or demo authority", !/development\/sandals|seller_demo_sandals|demoSeller/.test(reader));
  console.log(`Phase D2A seller config authority tests passed: ${results.length}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
