import { readFile } from "node:fs/promises";

const prohibited = [
  "src/modules/agent/agent.service.ts",
  "src/modules/agent/session/conversation-session.service.ts",
  "src/modules/agent/order/runtime/order-runtime-router.service.ts",
  "src/modules/agent/order/confirmed-order-store.service.ts",
  "src/modules/whatsapp/cloud/whatsapp-cloud.service.ts",
];

async function main(): Promise<void> {
  const results: string[] = [];
  const add = (name: string, pass: boolean) => { if (!pass) throw new Error(`FAIL: ${name}`); results.push(name); };
  const sources = await Promise.all(prohibited.map(async (path) => ({ path, source: await readFile(path, "utf8") })));
  for (const { path, source } of sources) {
    add(`${path} has no legacy SellerConfig authority`, !/sellerConfigService|SellerConfigService/.test(source));
    add(`${path} has no development-template authority`, !/modules\/development|sandals-development-template/.test(source));
  }
  const agent = sources.find(({ path }) => path.endsWith("agent.service.ts"))!.source;
  const session = sources.find(({ path }) => path.endsWith("conversation-session.service.ts"))!.source;
  const runtime = sources.find(({ path }) => path.endsWith("order-runtime-router.service.ts"))!.source;
  const receipt = sources.find(({ path }) => path.endsWith("whatsapp-cloud.service.ts"))!.source;
  add("Agent resolves persisted projection", agent.includes("sellerCommerceProjectionReader.resolve"));
  add("Session resolves persisted projection", session.includes("sellerCommerceProjectionReader.resolve"));
  add("Order runtime resolves persisted projection", runtime.includes("sellerCommerceProjectionReader.resolve"));
  add("Receipt sending uses immutable confirmed receipt flags", receipt.includes("confirmedOrder.receiptEnabled") && receipt.includes("confirmedOrder.receiptSendAfterConfirmation"));
  console.log(`Phase D2B legacy fallback removal tests passed: ${results.length}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
