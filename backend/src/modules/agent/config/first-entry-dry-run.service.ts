import type { ConversationSession } from "../agent-brain.types";
import { conversationKeyService } from "../identity/conversation-key.service";
import { renderIntentAwareFirstEntryPreview } from "./first-entry-intent-preview.service";
import type { IntentAwareFirstEntryPreviewResult } from "./first-entry-intent-preview.service";
import type { ProductContext } from "./product-context.types";
import type { SellerConfig } from "./seller-config.types";

export type FirstEntryDryRunMockState = {
  firstEntryShown?: boolean;
  hasSessionHistory?: boolean;
  orderFlowActive?: boolean;
  awaitingConfirmation?: boolean;
  orderConfirmed?: boolean;
  editFlowActive?: boolean;
  infoFlowActive?: boolean;
};

export type FirstEntryDryRunInput = {
  sellerConfig: SellerConfig;
  productContext: ProductContext;
  sellerId: string;
  customerPhone: string;
  message: string;
  mockState?: FirstEntryDryRunMockState;
};

export type FirstEntryDryRunResult = {
  ok: true;
  previewOnly: true;
  dryRun: true;
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  phase: "1F";
  result: IntentAwareFirstEntryPreviewResult & {
    handledBy: "first_entry_dry_run";
  };
  safety: {
    noLiveSend: true;
    noSessionMutation: true;
    noOrderMutation: true;
    noMetaApi: true;
  };
};

function createDryRunSession(input: {
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  productId: string;
  mockState?: FirstEntryDryRunMockState;
}): ConversationSession & {
  activeFlow?: "edit" | "info";
} {
  const now = new Date().toISOString();
  const mockState = input.mockState || {};
  const activeFlow = mockState.editFlowActive
    ? "edit"
    : mockState.infoFlowActive
      ? "info"
      : undefined;

  return {
    sessionId: conversationKeyService.buildSessionKey(input.conversationKey),
    customerId: input.conversationKey,
    customerPhone: input.customerPhone,
    conversationKey: input.conversationKey,
    sellerId: input.sellerId,
    productId: input.productId,
    messages: mockState.hasSessionHistory
      ? [
          {
            role: "customer",
            text: "previous dry-run message",
            timestamp: now,
          },
        ]
      : [],
    orderState: {
      collected: mockState.orderFlowActive ? { size: "38" } : {},
      missingFields: mockState.orderFlowActive ? ["phone"] : [],
      isComplete:
        mockState.awaitingConfirmation === true ||
        mockState.orderConfirmed === true,
      awaitingConfirmation: mockState.awaitingConfirmation === true,
      confirmed: mockState.orderConfirmed === true,
      lastUpdatedAt: now,
    },
    firstEntry: mockState.firstEntryShown
      ? {
          shown: true,
          shownAt: now,
        }
      : {
          shown: false,
        },
    ...(activeFlow ? { activeFlow } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function runFirstEntryDryRun(
  input: FirstEntryDryRunInput,
): FirstEntryDryRunResult {
  const conversationKey = conversationKeyService.buildConversationKey(
    input.sellerId,
    input.customerPhone,
  );
  const session = createDryRunSession({
    sellerId: input.sellerId,
    customerPhone: input.customerPhone,
    conversationKey,
    productId: input.productContext.productId,
    mockState: input.mockState,
  });
  const preview = renderIntentAwareFirstEntryPreview({
    sellerConfig: input.sellerConfig,
    productContext: input.productContext,
    customerMessage: input.message,
    session,
  });
  const resultText = preview.eligibility.eligible
    ? preview.text
    : "First entry is not eligible in this dry-run state.";

  return {
    ok: true,
    previewOnly: true,
    dryRun: true,
    sellerId: input.sellerId,
    customerPhone: input.customerPhone,
    conversationKey,
    phase: "1F",
    result: {
      ...preview,
      handledBy: "first_entry_dry_run",
      recommendedNextStep: preview.eligibility.eligible
        ? preview.recommendedNextStep
        : "do_not_show_first_entry",
      text: resultText,
    },
    safety: {
      noLiveSend: true,
      noSessionMutation: true,
      noOrderMutation: true,
      noMetaApi: true,
    },
  };
}
