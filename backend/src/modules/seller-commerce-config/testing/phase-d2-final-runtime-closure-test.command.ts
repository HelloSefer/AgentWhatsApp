import { readFile } from "node:fs/promises";

async function source(path: string): Promise<string> { return readFile(path, "utf8"); }
async function main(): Promise<void> {
  const results: string[] = [];
  const add = (name: string, pass: boolean) => { if (!pass) throw new Error(`FAIL: ${name}`); results.push(name); };
  const [agent, router, controller, cloud, projection] = await Promise.all([
    source("src/modules/agent/agent.service.ts"),
    source("src/modules/agent/order/runtime/order-runtime-router.service.ts"),
    source("src/modules/agent/order/runtime/order-runtime.controller.ts"),
    source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"),
    source("src/composition/runtime-read/seller-commerce-runtime-projection.ts"),
  ]);
  add("Agent production resolution uses persisted projection", agent.includes("sellerCommerceProjectionReader.resolve") && !agent.includes("product-context.service"));
  add("Guarded order runtime uses persisted projection", router.includes("sellerCommerceProjectionReader.resolve") && !router.includes("product-context.service"));
  add("Order runtime controller requires an explicit product", !controller.includes("productContextService") && controller.includes("PRODUCT_CONTEXT_REQUIRED"));
  add("Projection owns tenant-scoped catalog resolution through the exact connection binding", projection.includes("catalogService.getProduct(tenant, connection.boundProductId)") && projection.includes("createTenantContext(input.sellerId)"));
  add("Customer-owned inbound does not import smoke orchestration", !cloud.includes("first-entry-live-smoke.service"));
  add("Customer-owned inbound uses fail-closed credential policy", cloud.includes("const allowGlobalCredentialFallback = false"));
  add("No primary runtime development fixture import remains", !/modules\/development|sandals-development-template/.test(`${agent}\n${router}\n${cloud}`));
  add("Global token is not selected by connection-bound dispatch", !/const allowGlobalCredentialFallback = connection \? false : undefined/.test(cloud));
  console.log(`Phase D2 final runtime closure tests passed: ${results.length}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
