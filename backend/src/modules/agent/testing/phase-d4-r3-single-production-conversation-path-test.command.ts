import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

type Assertion = Readonly<{ name: string; passed: boolean }>;

const assertions: Assertion[] = [];

function add(name: string, passed: boolean): void {
  assertions.push({ name, passed });
}

function runFocusedFixture(commandFile: string): boolean {
  const result = spawnSync(process.execPath, [commandFile], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });
  return result.status === 0 && !result.error;
}

async function main(): Promise<void> {
  const [agentSource, cloudSource, productConfigSource, smokeSource] = await Promise.all([
    readFile("src/modules/agent/agent.service.ts", "utf8"),
    readFile("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts", "utf8"),
    readFile("src/modules/conversation-engine/config/conversation-product-config.service.ts", "utf8"),
    readFile("src/modules/agent/config/first-entry-live-smoke.service.ts", "utf8"),
  ]);

  add(
    "connected greeting and More Information remain on the approved Hybrid path",
    runFocusedFixture("dist/modules/agent/testing/phase-d4-r1-latest-hybrid-conversation-test.command.js"),
  );
  add(
    "connected dynamic Catalog, cart, delivery, confirmation, and receipt remain approved",
    runFocusedFixture("dist/modules/agent/testing/phase-d4-r2-dynamic-options-golden-flow-test.command.js"),
  );
  add(
    "Agent attaches the approved_hybrid routing invariant to connected production turns",
    agentSource.includes('function connectedConversationPath') &&
      agentSource.includes('return options?.connectionId') &&
      agentSource.includes('"approved_hybrid"'),
  );
  add(
    "legacy processOrderTurn cannot receive a connected production turn directly",
    agentSource.includes('usesApprovedConnectedHybrid(options)') &&
      agentSource.includes('!options?.useMemory || !options.customerId || usesApprovedConnectedHybrid(options)') &&
      agentSource.includes('const allowLegacyOrderCompatibility = !usesApprovedConnectedHybrid(options)'),
  );
  add(
    "Cloud carries the approved path marker as safe internal routing evidence",
    cloudSource.includes('conversationPath: result.meta?.conversationPath') &&
      cloudSource.includes('perMessageResult.conversationPath = result.meta?.conversationPath'),
  );
  add(
    "connected customer-owned traffic cannot enter the legacy Cloud order-flow branches",
    cloudSource.includes('!customerOwnedOrderRuntimeActivation && message.isFlowSubmission') &&
      cloudSource.includes('!customerOwnedOrderRuntimeActivation && isFlowTriggerText(message.text)') &&
      cloudSource.includes('!customerOwnedOrderRuntimeActivation &&\n        env.whatsappCloudOrderFlowOnOrderStart'),
  );
  add(
    "smoke helpers are not imported into the connected webhook path and remain explicitly guarded",
    !cloudSource.includes('buildFirstEntryLiveSmokeResult') &&
      smokeSource.includes('mode: "guarded_live_smoke_test_only"') &&
      smokeSource.includes('notProductionReady: true'),
  );
  add(
    "connected Catalog presentation preserves Catalog options instead of Conversation Config values",
    productConfigSource.includes('applyConnectedCatalogConversationPresentation') &&
      productConfigSource.includes('optionGroups: productContext.optionGroups'),
  );

  const passed = assertions.filter((assertion) => assertion.passed).length;
  const failed = assertions.length - passed;
  process.stdout.write(`${JSON.stringify({ phase: "D4-R3", summary: { total: assertions.length, passed, failed }, assertions }, null, 2)}\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ phase: "D4-R3", ok: false, message: error instanceof Error ? error.message : "single production path acceptance failed" })}\n`);
  process.exitCode = 1;
});
