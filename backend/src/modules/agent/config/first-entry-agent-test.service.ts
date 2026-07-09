import { runFirstEntryDryRun } from "./first-entry-dry-run.service";
import type {
  FirstEntryDryRunInput,
  FirstEntryDryRunMockState,
} from "./first-entry-dry-run.service";
import type {
  FirstEntryCtaPreview,
  FirstEntryUiHintsPreview,
} from "./first-entry-renderer.service";
import type {
  FirstEntryEligibilityResult,
} from "./first-entry-eligibility.service";
import type {
  FirstEntryIntentAnalysis,
  FirstEntryRecommendedNextStep,
} from "./first-entry-intent-preview.service";

export type FirstEntryAgentTestInput = Omit<
  FirstEntryDryRunInput,
  "mockState"
> & {
  mockState?: FirstEntryDryRunMockState;
};

export type FirstEntryAgentTestResult = {
  ok: true;
  mode: "agent_test";
  previewOnly: true;
  dryRun: true;
  handledBy: "first_entry_agent_test" | "first_entry_agent_test_blocked";
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  phase: "1G";
  reply: string;
  actions: [];
  uiHints?: FirstEntryUiHintsPreview;
  firstEntry: {
    intent: FirstEntryIntentAnalysis;
    eligibility: FirstEntryEligibilityResult;
    recommendedNextStep: FirstEntryRecommendedNextStep;
    ctas?: FirstEntryCtaPreview;
    warnings: string[];
  };
  safety: {
    noLiveSend: true;
    noSessionMutation: true;
    noOrderMutation: true;
    noMetaApi: true;
  };
};

export function runFirstEntryAgentTest(
  input: FirstEntryAgentTestInput,
): FirstEntryAgentTestResult {
  const dryRunResult = runFirstEntryDryRun(input);
  const preview = dryRunResult.result;
  const eligible = preview.eligibility.eligible;

  return {
    ok: true,
    mode: "agent_test",
    previewOnly: true,
    dryRun: true,
    handledBy: eligible
      ? "first_entry_agent_test"
      : "first_entry_agent_test_blocked",
    sellerId: dryRunResult.sellerId,
    customerPhone: dryRunResult.customerPhone,
    conversationKey: dryRunResult.conversationKey,
    phase: "1G",
    reply: eligible ? preview.text : "",
    actions: [],
    uiHints: preview.uiHints,
    firstEntry: {
      intent: preview.intent,
      eligibility: preview.eligibility,
      recommendedNextStep: eligible
        ? preview.recommendedNextStep
        : "do_not_show_first_entry",
      ctas: preview.ctas,
      warnings: preview.warnings || [],
    },
    safety: dryRunResult.safety,
  };
}
