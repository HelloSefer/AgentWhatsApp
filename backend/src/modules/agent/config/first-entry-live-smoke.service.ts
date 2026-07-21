import { env } from "../../../config/env";
import type { AgentResult } from "../agent-action.types";
import { normalizeFirstEntryClick } from "./first-entry-click-normalizer.service";
import { normalizeSellerConfig } from "./first-entry-config.service";
import {
  markFirstEntryShown,
} from "./first-entry-eligibility.service";
import { renderIntentAwareFirstEntryPreview } from "./first-entry-intent-preview.service";
import type { IntentAwareFirstEntryPreviewResult } from "./first-entry-intent-preview.service";
import { productContextService } from "./product-context.service";
import { sellerConfigService } from "./seller-config.service";
import {
  getConversationSession,
  saveConversationSession,
} from "../session/conversation-session.service";
import { conversationKeyService } from "../identity/conversation-key.service";
import { interactiveSendDecisionService } from "../reply/interactive-send-decision.service";
import type { InteractiveSendDecision } from "../reply/interactive-send-decision.types";
import { whatsappInteractiveMapper } from "../reply/whatsapp-interactive.mapper";
import type { AgentReplyUiHint } from "../reply/reply-renderer.types";
import type { WhatsAppInteractivePreview } from "../reply/whatsapp-interactive.types";
import type { ConversationSession } from "../agent-brain.types";
import { validateSellerConfigReadiness } from "./seller-config-readiness.service";

type FirstEntryLiveSmokePresentationMode =
  | "single_message"
  | "split_info_and_cta";

type FirstEntryLiveSmokePresentationMessage =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "interactive_buttons";
      text: string;
      buttons: Array<{
        id: string;
        label: string;
      }>;
    };

type FirstEntryLiveSmokePresentation = {
  presentationMode: FirstEntryLiveSmokePresentationMode;
  messages: FirstEntryLiveSmokePresentationMessage[];
};

export type FirstEntryLiveSmokeReadiness = {
  ok: true;
  ready: boolean;
  mode: "guarded_live_smoke_test_only";
  liveEnabled: boolean;
  firstEntryLiveSmokeEnabled: boolean;
  recipientAllowed: boolean;
  sellerIdConfigured: boolean;
  deliveryConfigReady: boolean;
  deliveryConfigReasons: string[];
  cloudProvider: boolean;
  cloudGuardEnabled: boolean;
  cloudDryRunDisabled: boolean;
  noBroadcast: true;
  notProductionReady: true;
  maskedTestRecipientPhone?: string;
  expectedSellerId?: string;
  requestedSellerId?: string;
  warnings: string[];
  checks: {
    whatsappProviderCloudApi: boolean;
    explicitLiveSmokeFlagEnabled: boolean;
    cloudLiveSendGuardEnabled: boolean;
    cloudDryRunDisabled: boolean;
    recipientExactlyAllowlisted: boolean;
    sellerIdConfigured: boolean;
    deliveryPricingReady: boolean;
    noBroadcast: true;
    noProviderPayload: true;
    noMetaApiCall: true;
    noSecrets: true;
  };
};

type BuildLiveSmokeResultInput = {
  customerPhone: string;
  phoneNumberId: string;
  message: string;
  sourceType?: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
};

type FirstEntryLiveSmokeBuildResult =
  | {
      handled: true;
      result: AgentResult;
      conversationKey: string;
      sellerId: string;
      customerPhone: string;
      readiness: FirstEntryLiveSmokeReadiness;
      session?: ConversationSession;
      reason: "first_entry_live_smoke";
    }
  | {
      handled: false;
      blockedReason: string;
      readiness: FirstEntryLiveSmokeReadiness;
    };

type FirstEntryInteractivePayload = {
  replyUi?: AgentReplyUiHint;
  whatsappInteractivePreview: WhatsAppInteractivePreview | null;
  interactiveSendDecision: InteractiveSendDecision;
  interactiveEnabled: boolean;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneForGuard(value: string | undefined): string {
  return cleanText(value).replace(/[^\d]/g, "");
}

function maskPhone(value: string | undefined): string | undefined {
  const cleanValue = normalizePhoneForGuard(value);

  if (!cleanValue) {
    return undefined;
  }

  return cleanValue.length > 6
    ? `${cleanValue.slice(0, 3)}***${cleanValue.slice(-3)}`
    : "***";
}

function isCleanFirstEntryMessage(message: string): boolean {
  const cleanMessage = cleanText(message);

  return (
    cleanMessage.length > 0 &&
    cleanMessage.length <= 500 &&
    !cleanMessage.startsWith("first_entry:")
  );
}

function isFirstEntryClickInput(input: {
  message?: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
}): boolean {
  const rawClickInput =
    cleanText(input.buttonReplyId) ||
    cleanText(input.buttonReplyTitle) ||
    cleanText(input.message);
  const normalized = normalizeFirstEntryClick(rawClickInput);

  return normalized.recognized === true;
}

function buildWarnings(input: {
  cloudProvider: boolean;
  liveSmokeEnabled: boolean;
  cloudGuardEnabled: boolean;
  cloudDryRunDisabled: boolean;
  recipientAllowed: boolean;
  sellerIdConfigured: boolean;
  configuredRecipient: string;
  requestedRecipient: string;
  configuredSellerId: string;
  requestedSellerId?: string;
  deliveryConfigReady: boolean;
  deliveryConfigReasons: string[];
}): string[] {
  const warnings: string[] = [];

  if (!input.cloudProvider) {
    warnings.push("WHATSAPP_PROVIDER must be cloud_api.");
  }

  if (!input.liveSmokeEnabled) {
    warnings.push("FIRST_ENTRY_LIVE_SMOKE_ENABLED must be true.");
  }

  if (!input.cloudGuardEnabled) {
    warnings.push("WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED must be true.");
  }

  if (!input.cloudDryRunDisabled) {
    warnings.push("WHATSAPP_CLOUD_DRY_RUN must be false for the smoke test.");
  }

  if (!input.configuredRecipient) {
    warnings.push("FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT must be configured.");
  } else if (!input.requestedRecipient) {
    warnings.push("testRecipientPhone is required for readiness.");
  } else if (!input.recipientAllowed) {
    warnings.push("Requested recipient does not match the allowlisted test recipient.");
  }

  if (!input.configuredSellerId) {
    warnings.push("FIRST_ENTRY_LIVE_SMOKE_SELLER_ID must be configured.");
  } else if (
    input.requestedSellerId &&
    input.requestedSellerId !== input.configuredSellerId
  ) {
    warnings.push("Requested sellerId does not match the configured smoke seller.");
  }

  if (!input.deliveryConfigReady) {
    warnings.push(
      ...input.deliveryConfigReasons.map(
        (reason) => `Seller delivery pricing is not ready: ${reason}`,
      ),
    );
  }

  warnings.push("Guarded smoke test only. Not production ready.");

  return warnings;
}

export function buildFirstEntryLiveSmokeReadiness(input: {
  testRecipientPhone?: string;
  sellerId?: string;
} = {}): FirstEntryLiveSmokeReadiness {
  const configuredRecipient = normalizePhoneForGuard(
    env.firstEntryLiveSmokeTestRecipient,
  );
  const requestedRecipient = normalizePhoneForGuard(input.testRecipientPhone);
  const configuredSellerId = cleanText(env.firstEntryLiveSmokeSellerId);
  const requestedSellerId = cleanText(input.sellerId);
  const cloudProvider = env.whatsappProvider === "cloud_api";
  const firstEntryLiveSmokeEnabled = env.firstEntryLiveSmokeEnabled === true;
  const cloudGuardEnabled = env.whatsappInteractiveLiveSendAllowed === true;
  const cloudDryRunDisabled = env.whatsappCloudDryRun !== true;
  const recipientAllowed =
    Boolean(configuredRecipient) &&
    Boolean(requestedRecipient) &&
    requestedRecipient === configuredRecipient;
  const sellerIdConfigured =
    Boolean(configuredSellerId) &&
    (!requestedSellerId || requestedSellerId === configuredSellerId) &&
    sellerConfigService.hasSellerConfig(configuredSellerId);
  const deliveryConfigReadiness = sellerConfigService.hasSellerConfig(
    requestedSellerId || configuredSellerId,
  )
    ? validateSellerConfigReadiness(
        sellerConfigService.getSellerConfig(requestedSellerId || configuredSellerId),
      )
    : {
        ready: false,
        reasons: ["Configured seller does not exist."],
        checks: { deliveryPricing: false },
      };
  const liveEnabled =
    cloudProvider &&
    firstEntryLiveSmokeEnabled &&
    cloudGuardEnabled &&
    cloudDryRunDisabled;
  const ready =
    liveEnabled &&
    recipientAllowed &&
    sellerIdConfigured &&
    deliveryConfigReadiness.ready;

  return {
    ok: true,
    ready,
    mode: "guarded_live_smoke_test_only",
    liveEnabled,
    firstEntryLiveSmokeEnabled,
    recipientAllowed,
    sellerIdConfigured,
    deliveryConfigReady: deliveryConfigReadiness.ready,
    deliveryConfigReasons: deliveryConfigReadiness.reasons,
    cloudProvider,
    cloudGuardEnabled,
    cloudDryRunDisabled,
    noBroadcast: true,
    notProductionReady: true,
    maskedTestRecipientPhone: maskPhone(requestedRecipient || configuredRecipient),
    expectedSellerId: configuredSellerId || undefined,
    requestedSellerId: requestedSellerId || undefined,
    warnings: buildWarnings({
      cloudProvider,
      liveSmokeEnabled: firstEntryLiveSmokeEnabled,
      cloudGuardEnabled,
      cloudDryRunDisabled,
      recipientAllowed,
      sellerIdConfigured,
      configuredRecipient,
      requestedRecipient,
      configuredSellerId,
      requestedSellerId,
      deliveryConfigReady: deliveryConfigReadiness.ready,
      deliveryConfigReasons: deliveryConfigReadiness.reasons,
    }),
    checks: {
      whatsappProviderCloudApi: cloudProvider,
      explicitLiveSmokeFlagEnabled: firstEntryLiveSmokeEnabled,
      cloudLiveSendGuardEnabled: cloudGuardEnabled,
      cloudDryRunDisabled,
      recipientExactlyAllowlisted: recipientAllowed,
      sellerIdConfigured,
      deliveryPricingReady: deliveryConfigReadiness.ready,
      noBroadcast: true,
      noProviderPayload: true,
      noMetaApiCall: true,
      noSecrets: true,
    },
  };
}

function getFirstEntryReplyUi(
  replyUi: AgentReplyUiHint,
  body?: string,
): AgentReplyUiHint {
  return {
    ...replyUi,
    ...(body ? { body } : {}),
    previewOnly: false,
  };
}

function getFirstEntryInteractiveEnabled(
  override?: boolean,
): boolean {
  if (typeof override === "boolean") {
    return override;
  }

  return (
    env.whatsappInteractiveEnabled ||
    (env.whatsappCloudReplyButtonsEnabled &&
      env.whatsappInteractiveChoicesEnabled)
  );
}

function buildFirstEntryInteractivePayload(input: {
  replyText: string;
  firstEntry: IntentAwareFirstEntryPreviewResult;
  interactiveEnabledOverride?: boolean;
}): FirstEntryInteractivePayload {
  const replyUi = input.firstEntry.uiHints?.replyUi
    ? getFirstEntryReplyUi(input.firstEntry.uiHints.replyUi, input.replyText)
    : undefined;
  const whatsappInteractivePreview =
    whatsappInteractiveMapper.toCloudInteractivePreview({
      replyText: input.replyText,
      replyUi,
    });
  const interactiveEnabled = getFirstEntryInteractiveEnabled(
    input.interactiveEnabledOverride,
  );
  const interactiveSendDecision = interactiveSendDecisionService.decide({
    channel: "whatsapp_cloud",
    interactiveEnabled,
    whatsappInteractivePreview,
  });

  return {
    replyUi,
    whatsappInteractivePreview,
    interactiveSendDecision,
    interactiveEnabled,
  };
}

function getSplitCtaQuestion(): string {
  return "شنو بغيتي دابا: دير الطلب ✅ ولا تعرف المزيد من المعلومات على المنتج؟";
}

function normalizeInfoLine(line: string): string {
  return line.trim().replace(/\.$/, "");
}

function buildFirstEntryInfoText(
  firstEntry: IntentAwareFirstEntryPreviewResult,
): string {
  const ctaLine = firstEntry.renderResult.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  const lines = [...firstEntry.renderResult.lines];

  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  if (ctaLine && lines[lines.length - 1]?.trim() === ctaLine) {
    lines.pop();
  }

  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines
    .map((line) => (line.trim() ? normalizeInfoLine(line) : line))
    .join("\n")
    .trim();
}

function getFirstEntryButtons(firstEntry: IntentAwareFirstEntryPreviewResult) {
  return (firstEntry.ctas?.items || [])
    .filter((item) => item.enabled)
    .map((item) => ({
      id: item.id,
      label: item.label,
    }));
}

function buildFirstEntryPresentation(
  firstEntry: IntentAwareFirstEntryPreviewResult,
): FirstEntryLiveSmokePresentation {
  const infoText = buildFirstEntryInfoText(firstEntry);
  const buttons = getFirstEntryButtons(firstEntry);
  const ctaText = getSplitCtaQuestion();

  if (!buttons.length) {
    return {
      presentationMode: "single_message",
      messages: [
        {
          kind: "text",
          text: infoText || firstEntry.text,
        },
      ],
    };
  }

  return {
    presentationMode: "split_info_and_cta",
    messages: [
      {
        kind: "text",
        text: infoText || firstEntry.text,
      },
      {
        kind: "interactive_buttons",
        text: ctaText,
        buttons,
      },
    ],
  };
}

function buildEmptyPreviewSession(input: {
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  productId?: string;
}): ConversationSession {
  const now = new Date().toISOString();

  return {
    sessionId: conversationKeyService.buildSessionKey(input.conversationKey),
    customerId: input.conversationKey,
    customerPhone: input.customerPhone,
    conversationKey: input.conversationKey,
    sellerId: input.sellerId,
    productId: input.productId,
    messages: [],
    orderState: {
      collected: {},
      missingFields: [],
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
      lastUpdatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function buildFirstEntryLiveSmokeDispatchPreview(input: {
  sellerId?: string;
  customerPhone?: string;
  message?: string;
  interactiveEnabledOverride?: boolean;
}) {
  const sellerId = cleanText(input.sellerId) || env.firstEntryLiveSmokeSellerId;
  const customerPhone = normalizePhoneForGuard(
    input.customerPhone || env.firstEntryLiveSmokeTestRecipient,
  );
  const message = cleanText(input.message) || "سلام";
  const conversationKey = conversationKeyService.buildConversationKey(
    sellerId,
    customerPhone,
  );
  const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
  const productResult =
    productContextService.getActiveProductContextWithMeta(sellerId);
  const sellerConfig = normalizeSellerConfig(
    sellerResult.sellerConfig,
    productResult.productContext.price,
  );
  const session = buildEmptyPreviewSession({
    sellerId,
    customerPhone,
    conversationKey,
    productId: productResult.productContext.productId,
  });
  const firstEntry = renderIntentAwareFirstEntryPreview({
    sellerConfig,
    productContext: productResult.productContext,
    session,
    orderState: session.orderState,
    customerMessage: message,
  });
  const interactive = buildFirstEntryInteractivePayload({
    replyText:
      buildFirstEntryPresentation(firstEntry).messages.find(
        (message) => message.kind === "interactive_buttons",
      )?.text || firstEntry.text,
    firstEntry,
    interactiveEnabledOverride: input.interactiveEnabledOverride,
  });
  const presentation = buildFirstEntryPresentation(firstEntry);

  return {
    ok: true,
    previewOnly: true,
    dryRun: true,
    noLiveSend: true,
    sellerId,
    customerPhone,
    conversationKey,
    reply: presentation.messages.map((message) => message.text).join("\n\n"),
    presentationMode: presentation.presentationMode,
    messages: presentation.messages,
    ctas: firstEntry.ctas,
    uiHints: firstEntry.uiHints,
    replyUi: interactive.replyUi,
    whatsappInteractivePreview: interactive.whatsappInteractivePreview,
    interactiveSendDecision: interactive.interactiveSendDecision,
    interactiveEnabled: interactive.interactiveEnabled,
    fallbackUsed: sellerResult.fallbackUsed || productResult.fallbackUsed,
  };
}

export async function buildFirstEntryLiveSmokeResult(
  input: BuildLiveSmokeResultInput,
): Promise<FirstEntryLiveSmokeBuildResult> {
  const sellerId = cleanText(env.firstEntryLiveSmokeSellerId);
  const customerPhone = normalizePhoneForGuard(input.customerPhone);
  const readiness = buildFirstEntryLiveSmokeReadiness({
    testRecipientPhone: customerPhone,
    sellerId,
  });

  if (!readiness.ready) {
    return {
      handled: false,
      blockedReason: "first_entry_live_smoke_readiness_not_ready",
      readiness,
    };
  }

  const conversationKey = conversationKeyService.buildConversationKey(
    sellerId,
    customerPhone,
  );

  if (
    isFirstEntryClickInput({
      message: input.message,
      buttonReplyId: input.buttonReplyId,
      buttonReplyTitle: input.buttonReplyTitle,
    })
  ) {
    const rawInput = input.buttonReplyId || input.buttonReplyTitle || input.message;
    const click = normalizeFirstEntryClick(rawInput);

    return {
      handled: false,
      blockedReason:
        click.intent === "order"
          ? "first_entry_order_click_routes_to_phase_2a_order_path"
          : "first_entry_info_click_routes_to_phase_3a_info_path",
      readiness,
    };
  }

  if (!isCleanFirstEntryMessage(input.message)) {
    return {
      handled: false,
      blockedReason: "first_entry_live_smoke_unclean_message",
      readiness,
    };
  }

  const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
  const productResult =
    productContextService.getActiveProductContextWithMeta(sellerId);

  if (sellerResult.fallbackUsed || productResult.fallbackUsed) {
    return {
      handled: false,
      blockedReason: "first_entry_live_smoke_seller_or_product_not_configured",
      readiness,
    };
  }

  const sellerConfig = normalizeSellerConfig(
    sellerResult.sellerConfig,
    productResult.productContext.price,
  );
  const session = await getConversationSession(
    conversationKey,
    sellerId,
    productResult.productContext.productId,
    customerPhone,
  );
  const firstEntry = renderIntentAwareFirstEntryPreview({
    sellerConfig,
    productContext: productResult.productContext,
    session,
    orderState: session.orderState,
    customerMessage: input.message,
  });

  if (!firstEntry.eligibility.eligible || !firstEntry.text.trim()) {
    return {
      handled: false,
      blockedReason: firstEntry.eligibility.reason,
      readiness,
    };
  }

  const interactive = buildFirstEntryInteractivePayload({
    replyText:
      buildFirstEntryPresentation(firstEntry).messages.find(
        (message) => message.kind === "interactive_buttons",
      )?.text || firstEntry.text,
    firstEntry,
  });
  const presentation = buildFirstEntryPresentation(firstEntry);
  const firstMessageText =
    presentation.messages.find((message) => message.kind === "text")?.text ||
    firstEntry.text;
  const ctaMessageText =
    presentation.messages.find((message) => message.kind === "interactive_buttons")
      ?.text || firstEntry.text;

  return {
    handled: true,
    result: {
      reply: ctaMessageText,
      actions: [],
      source: "direct",
      meta: {
        source: "direct",
        replyUi: interactive.replyUi,
        whatsappInteractivePreview: interactive.whatsappInteractivePreview,
        interactiveSendDecision: interactive.interactiveSendDecision,
        firstEntryLiveSmoke: {
          handledBy: "first_entry_live_smoke",
          readinessReady: readiness.ready,
          eligibilityReason: firstEntry.eligibility.reason,
          recommendedNextStep: firstEntry.recommendedNextStep,
          interactiveEnabled: interactive.interactiveEnabled,
          ctas: firstEntry.ctas,
          uiHints: firstEntry.uiHints,
          presentationMode: presentation.presentationMode,
          messages: presentation.messages,
        },
        identity: {
          sellerId,
          customerPhone,
          conversationKey,
          phoneNumberId: input.phoneNumberId,
        },
      },
    },
    conversationKey,
    sellerId,
    customerPhone,
    readiness,
    session,
    reason: "first_entry_live_smoke",
  };
}

export async function markFirstEntryLiveSmokeShown(input: {
  conversationKey: string;
  sellerId: string;
  customerPhone: string;
}) {
  const session = await getConversationSession(
    input.conversationKey,
    input.sellerId,
    undefined,
    input.customerPhone,
  );
  const updatedSession = markFirstEntryShown(session);

  await saveConversationSession(updatedSession);

  return updatedSession;
}
