import type { Request, Response } from "express";
import { env } from "../../config/env";
import { generateAgentResult, resolveAgentIdentity } from "./agent.service";
import { runFirstEntryAgentTest } from "./config/first-entry-agent-test.service";
import { normalizeFirstEntryClick } from "./config/first-entry-click-normalizer.service";
import { runFirstEntryDryRun } from "./config/first-entry-dry-run.service";
import {
  buildFirstEntryLiveSmokeDispatchPreview,
  buildFirstEntryLiveSmokeReadiness,
} from "./config/first-entry-live-smoke.service";
import { analyzeAIIntentWithMeta } from "./ai/ai-intent-router.service";
import { evaluateIntentRouter } from "./ai/ai-intent-router-eval.service";
import type { IntentEvalCase } from "./ai/ai-intent-router-eval.service";
import { aiIntentRouterIntentValues } from "./ai/ai-intent-router.schema";
import { evaluateSalesReplies } from "./sales/sales-response-eval.service";
import type { SalesReplyEvalCase } from "./sales/sales-response-eval.service";
import {
  benchmarkNaturalReplies,
  evaluateNaturalReplies,
} from "./natural-reply/natural-reply-eval.service";
import type { NaturalReplyEvalCase } from "./natural-reply/natural-reply-eval.service";
import {
  getNaturalReplyStatus,
  resetNaturalReplyState,
  smokeTestNaturalReply,
} from "./natural-reply/natural-reply-generator.service";
import { evaluateSellerBrain } from "./seller-brain/seller-brain-eval.service";
import type { SellerBrainEvalCase } from "./seller-brain/seller-brain.types";
import { evaluateConversationScenarios } from "./conversation-scenario-eval.service";
import { evaluateContextualOrderUnderstanding } from "./order-understanding/contextual-order-understanding-eval.service";
import { evaluateInformationalAIBoundary } from "./info/informational-ai-answer-eval.service";
import { isContextualOrderUnderstandingEvaluationEnabled } from "./order-understanding/evaluation-access.policy";
import {
  adminNotificationTypes,
  deleteAdminNotification,
  getAdminNotificationById,
  isAdminNotificationType,
  listAdminNotifications,
  markAllAdminNotificationsRead,
  markAdminNotificationRead,
} from "./admin/admin-notification.service";
import type { AdminNotificationType } from "./admin/admin-notification.service";
import {
  getConfirmedOrderById,
  isOrderStatus,
  listConfirmedOrders,
  normalizeOrderStatus,
  updateConfirmedOrderStatus,
  orderStatuses,
} from "./order/confirmed-order-store.service";
import { normalizeSellerConfig } from "./config/first-entry-config.service";
import { productContextService } from "./config/product-context.service";
import { sellerConfigService } from "./config/seller-config.service";
import { conversationKeyService } from "./identity/conversation-key.service";
import { getConversationSession } from "./session/conversation-session.service";
import type { ConversationOrderState } from "./agent-brain.types";
import type { ProductContext } from "./product-context.types";
import { validateSellerConfigReadiness } from "./config/seller-config-readiness.service";
import { offerConfigService } from "./config/offers/offer-config.service";
import { runCartPlanningPreview } from "./order/planning/preview/cart-planning-preview.service";
import type { CartDraft } from "./order/cart-state.types";
import type { CartPlanningPreviewState } from "./order/planning/quantity/flow/cart-custom-quantity-flow.types";

function isAIIntentRouterIntent(value: unknown): boolean {
  return (
    typeof value === "string" &&
    aiIntentRouterIntentValues.includes(
      value as (typeof aiIntentRouterIntentValues)[number],
    )
  );
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getOptionalBooleanQuery(
  value: unknown,
): boolean | "invalid" | undefined {
  const text = getOptionalString(value)?.toLowerCase();

  if (!text) {
    return undefined;
  }

  if (text === "true") {
    return true;
  }

  if (text === "false") {
    return false;
  }

  return "invalid";
}

function getDryRunMockState(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  return {
    firstEntryShown: candidate.firstEntryShown === true,
    hasSessionHistory: candidate.hasSessionHistory === true,
    orderFlowActive: candidate.orderFlowActive === true,
    awaitingConfirmation: candidate.awaitingConfirmation === true,
    orderConfirmed: candidate.orderConfirmed === true,
    editFlowActive: candidate.editFlowActive === true,
    infoFlowActive: candidate.infoFlowActive === true,
  };
}

function isFirstEntryAgentTestRequested(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }

  const candidate = body as Record<string, unknown>;

  return (
    candidate.enableFirstEntryPreview === true ||
    candidate.firstEntryMode === "preview"
  );
}

function isFirstEntryClickPreviewRequested(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }

  const candidate = body as Record<string, unknown>;

  return (
    candidate.enableFirstEntryClickPreview === true ||
    candidate.firstEntryClickMode === "preview"
  );
}

function isCartPlanningPreviewRequested(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  return candidate.enableCartPlanningPreview === true || candidate.cartPlanningMode === "preview";
}

function getCartPlanningPreviewActionInput(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "";
  }

  const candidate = body as Record<string, unknown>;
  return candidate.planningActionId || candidate.interactiveReplyId || candidate.message || "";
}

function getCartPlanningPreviewCart(value: unknown): CartDraft | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as CartDraft;
}

function getCartPlanningPreviewState(
  value: unknown,
): CartPlanningPreviewState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as CartPlanningPreviewState;
}

function getCartPlanningPreviewText(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  return (body as Record<string, unknown>).planningText;
}

function getFirstEntryClickInput(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "";
  }

  const candidate = body as Record<string, unknown>;

  return (
    candidate.clickId ||
    candidate.interactiveReplyId ||
    candidate.text ||
    candidate.message ||
    ""
  );
}

function buildFirstEntryClickPreviewResponse(input: {
  sellerId: string;
  customerPhone: string;
  rawInput: unknown;
}) {
  const conversationKey = conversationKeyService.buildConversationKey(
    input.sellerId,
    input.customerPhone,
  );

  return {
    ok: true,
    previewOnly: true,
    dryRun: true,
    sellerId: input.sellerId,
    customerPhone: input.customerPhone,
    conversationKey,
    result: normalizeFirstEntryClick(input.rawInput),
    safety: {
      noLiveSend: true,
      noMetaApi: true,
      noSessionMutation: true,
      noOrderMutation: true,
      noLiveRouting: true,
    },
  };
}

export function firstEntryDryRun(req: Request, res: Response) {
  const sellerId = getOptionalString(req.body?.sellerId) || "seller_demo_sandals";
  const customerPhone = getOptionalString(req.body?.customerPhone);
  const message = typeof req.body?.message === "string" ? req.body.message : "";

  if (!customerPhone) {
    return res.status(400).json({
      ok: false,
      previewOnly: true,
      dryRun: true,
      message: "customerPhone is required",
    });
  }

  if (!message.trim()) {
    return res.status(400).json({
      ok: false,
      previewOnly: true,
      dryRun: true,
      message: "message is required",
    });
  }

  try {
    const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
    const productResult =
      productContextService.getActiveProductContextWithMeta(sellerId);
    const sellerConfig = normalizeSellerConfig(
      sellerResult.sellerConfig,
      productResult.productContext.price,
    );
    const result = runFirstEntryDryRun({
      sellerConfig,
      productContext: productResult.productContext,
      sellerId: sellerConfig.sellerId,
      customerPhone,
      message,
      mockState: getDryRunMockState(req.body?.mockState),
    });

    return res.status(200).json({
      ...result,
      requestedSellerId: sellerId,
      fallbackUsed: sellerResult.fallbackUsed || productResult.fallbackUsed,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      previewOnly: true,
      dryRun: true,
      message: "First entry dry-run failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function firstEntryClickPreview(req: Request, res: Response) {
  const sellerId = getOptionalString(req.body?.sellerId) || "seller_demo_sandals";
  const customerPhone = getOptionalString(req.body?.customerPhone);

  if (!customerPhone) {
    return res.status(400).json({
      ok: false,
      previewOnly: true,
      dryRun: true,
      message: "customerPhone is required",
    });
  }

  try {
    return res.status(200).json(
      buildFirstEntryClickPreviewResponse({
        sellerId,
        customerPhone,
        rawInput: getFirstEntryClickInput(req.body),
      }),
    );
  } catch (error) {
    return res.status(500).json({
      ok: false,
      previewOnly: true,
      dryRun: true,
      message: "First entry click preview failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function getFirstEntryReadiness(req: Request, res: Response) {
  const sellerId = getOptionalString(req.query.sellerId) || "seller_demo_sandals";
  const sellerExists = sellerConfigService.hasSellerConfig(sellerId);
  const sellerReadiness = sellerExists
    ? validateSellerConfigReadiness(sellerConfigService.getSellerConfig(sellerId))
    : {
        ready: false,
        reasons: ["Seller configuration was not found."],
        checks: { deliveryPricing: false },
      };

  return res.status(200).json({
    ok: true,
    readiness: sellerReadiness.ready
      ? "ready_for_guarded_test_activation"
      : "configuration_not_ready",
    sellerId,
    reasons: sellerReadiness.reasons,
    previewOnly: true,
    liveEnabled: false,
    checks: {
      config: sellerReadiness.ready,
      deliveryPricing: sellerReadiness.checks.deliveryPricing,
      renderer: true,
      eligibility: true,
      ctaPreview: true,
      intentPreview: true,
      dryRunIntegration: true,
      agentTestIntegration: true,
      clickNormalization: true,
      noLiveSend: true,
      noMetaApi: true,
      noAiLlm: true,
      noMediaSend: true,
      noSessionMutationInPreview: true,
      noOrderMutationInPreview: true,
      noCtaLiveRouting: true,
      explicitOptInOnly: true,
    },
    nextAllowedStep: "guarded_non_live_activation_or_phase_2_planning",
  });
}

export function getFirstEntryLiveSmokeReadiness(req: Request, res: Response) {
  return res.status(200).json(
    buildFirstEntryLiveSmokeReadiness({
      testRecipientPhone: getOptionalString(req.query.testRecipientPhone),
      sellerId: getOptionalString(req.query.sellerId),
    }),
  );
}

export function firstEntryLiveSmokeDispatchPreview(req: Request, res: Response) {
  return res.status(200).json(
    buildFirstEntryLiveSmokeDispatchPreview({
      sellerId: getOptionalString(req.body?.sellerId),
      customerPhone:
        getOptionalString(req.body?.customerPhone) ||
        getOptionalString(req.body?.customerId),
      message: getOptionalString(req.body?.message),
      interactiveEnabledOverride:
        typeof req.body?.interactiveEnabledOverride === "boolean"
          ? req.body.interactiveEnabledOverride
          : undefined,
    }),
  );
}

export async function testAgentReply(req: Request, res: Response) {
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const cartPlanningPreviewRequested = isCartPlanningPreviewRequested(req.body);
  const firstEntryClickPreviewRequested = isFirstEntryClickPreviewRequested(
    req.body,
  );

  if (!message.trim() && !firstEntryClickPreviewRequested && !cartPlanningPreviewRequested) {
    return res.status(400).json({
      message: "Message is required",
    });
  }

  if (cartPlanningPreviewRequested) {
    const sellerId = getOptionalString(req.body?.sellerId) || "seller_demo_sandals";
    const customerPhone =
      getOptionalString(req.body?.customerPhone) ||
      getOptionalString(req.body?.customerId);

    if (!customerPhone) {
      return res.status(400).json({
        ok: false,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "cart_planning_preview_blocked",
        message: "customerPhone is required for cart planning preview",
      });
    }

    try {
      const productResult = productContextService.getActiveProductContextWithMeta(sellerId);
      const productContext = productResult.productContext;
      const offerLookup = offerConfigService.getConfiguredOffers({
        sellerId: productContext.sellerId,
        productId: productContext.productId,
      });
      const result = runCartPlanningPreview({
        previewEnabled: true,
        rawActionId: getCartPlanningPreviewActionInput(req.body),
        sellerId: productContext.sellerId,
        productContext,
        offerLookup,
        cart: getCartPlanningPreviewCart(req.body?.previewCart),
        previewPlanningState: getCartPlanningPreviewState(
          req.body?.previewPlanningState,
        ),
        planningText: getCartPlanningPreviewText(req.body),
        now: new Date(),
      });

      return res.status(200).json({
        ok: true,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "cart_planning_preview",
        sellerId: productContext.sellerId,
        customerPhone,
        result,
        fallbackUsed: productResult.fallbackUsed,
        safety: {
          noLiveSend: true,
          noMetaApi: true,
          noSessionMutation: true,
          noOrderMutation: true,
          noLiveRouting: true,
        },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "cart_planning_preview_blocked",
        message: "Cart planning preview failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (firstEntryClickPreviewRequested) {
    const sellerId =
      getOptionalString(req.body?.sellerId) || "seller_demo_sandals";
    const customerPhone =
      getOptionalString(req.body?.customerPhone) ||
      getOptionalString(req.body?.customerId);

    if (!customerPhone) {
      return res.status(400).json({
        ok: false,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "first_entry_click_preview_blocked",
        message: "customerPhone is required for first-entry click preview",
      });
    }

    try {
      const preview = buildFirstEntryClickPreviewResponse({
        sellerId,
        customerPhone,
        rawInput: getFirstEntryClickInput(req.body),
      });

      return res.status(200).json({
        ...preview,
        mode: "agent_test",
        handledBy: "first_entry_click_preview",
        reply: "",
        actions: [],
        firstEntryClick: preview.result,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "first_entry_click_preview_blocked",
        message: "First entry click preview failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (isFirstEntryAgentTestRequested(req.body)) {
    const sellerId =
      getOptionalString(req.body?.sellerId) || "seller_demo_sandals";
    const customerPhone =
      getOptionalString(req.body?.customerPhone) ||
      getOptionalString(req.body?.customerId);

    if (!customerPhone) {
      return res.status(400).json({
        ok: false,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "first_entry_agent_test_blocked",
        message: "customerPhone is required for first-entry preview",
      });
    }

    try {
      const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
      const productResult =
        productContextService.getActiveProductContextWithMeta(sellerId);
      const sellerConfig = normalizeSellerConfig(
        sellerResult.sellerConfig,
        productResult.productContext.price,
      );
      const result = runFirstEntryAgentTest({
        sellerConfig,
        productContext: productResult.productContext,
        sellerId: sellerConfig.sellerId,
        customerPhone,
        message,
        mockState: getDryRunMockState(req.body?.mockState),
      });

      return res.status(200).json({
        ...result,
        requestedSellerId: sellerId,
        fallbackUsed: sellerResult.fallbackUsed || productResult.fallbackUsed,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        mode: "agent_test",
        previewOnly: true,
        dryRun: true,
        handledBy: "first_entry_agent_test_blocked",
        message: "First entry agent test failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const result = await generateAgentResult(message, productContext, {
      customerId: getOptionalString(req.body?.customerId),
      customerPhone: getOptionalString(req.body?.customerPhone),
      conversationKey: getOptionalString(req.body?.conversationKey),
      sellerId: getOptionalString(req.body?.sellerId),
      productId: getOptionalString(req.body?.productId),
      phoneNumberId: getOptionalString(req.body?.phoneNumberId),
      useMemory: req.body?.useMemory === true,
    });

    return res.status(200).json({
      reply: result.reply,
      actions: result.actions,
      source: result.source,
      meta: result.meta,
      identity: result.meta?.identity,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Agent generation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testAgentIntent(req: Request, res: Response) {
  const message = typeof req.body?.message === "string" ? req.body.message : "";

  if (!message.trim()) {
    return res.status(400).json({
      message: "Message is required",
    });
  }

  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const customerId = getOptionalString(req.body?.customerId);
    const customerPhone = getOptionalString(req.body?.customerPhone);
    const conversationKey = getOptionalString(req.body?.conversationKey);
    const sellerId = getOptionalString(req.body?.sellerId);
    const productId = getOptionalString(req.body?.productId);
    const identity = resolveAgentIdentity({
      customerId,
      customerPhone,
      conversationKey,
      sellerId,
      productId,
      phoneNumberId: getOptionalString(req.body?.phoneNumberId),
    });
    const memoryCustomerId = identity?.conversationKey || customerId;
    const requestOrderState =
      typeof req.body?.orderState === "object" && req.body.orderState !== null
        ? (req.body.orderState as ConversationOrderState)
        : undefined;
    const sessionContext =
      req.body?.useMemory === true && memoryCustomerId
        ? await getConversationSession(
            memoryCustomerId,
            identity?.sellerId || sellerId,
            productId,
            identity?.customerPhone || customerPhone,
          )
        : undefined;
    const result = await analyzeAIIntentWithMeta({
      message,
      productContext,
      sessionContext,
      orderState: requestOrderState,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "AI intent routing failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentIntents(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return (
          typeof candidate.message !== "string" ||
          !candidate.message.trim() ||
          !isAIIntentRouterIntent(candidate.expectedIntent)
        );
      });

      if (invalidCase) {
        return res.status(400).json({
          message:
            "Each case requires message and a supported expectedIntent",
          allowedIntents: aiIntentRouterIntentValues,
        });
      }
    }

    const report = await evaluateIntentRouter({
      productContext,
      cases: cases as IntentEvalCase[] | undefined,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Intent evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentReplies(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (typeof testCase === "string") {
          return !testCase.trim();
        }

        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return typeof candidate.message !== "string" || !candidate.message.trim();
      });

      if (invalidCase) {
        return res.status(400).json({
          message: "Each reply eval case must be a message string or an object with message",
        });
      }
    }

    const normalizedCases = cases?.map((testCase) =>
      typeof testCase === "string"
        ? { message: testCase }
        : (testCase as SalesReplyEvalCase),
    );
    const report = await evaluateSalesReplies({
      productContext,
      cases: normalizedCases,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Reply evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentNaturalReplies(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (typeof testCase === "string") {
          return !testCase.trim();
        }

        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return typeof candidate.message !== "string" || !candidate.message.trim();
      });

      if (invalidCase) {
        return res.status(400).json({
          message:
            "Each natural reply eval case must be a message string or an object with message",
        });
      }
    }

    const normalizedCases = cases?.map((testCase) =>
      typeof testCase === "string"
        ? { message: testCase }
        : (testCase as NaturalReplyEvalCase),
    );
    const report = await evaluateNaturalReplies({
      productContext,
      cases: normalizedCases,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Natural reply evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function getAgentNaturalReplyStatus(_req: Request, res: Response) {
  return res.status(200).json(getNaturalReplyStatus());
}

export function resetAgentNaturalReplyState(_req: Request, res: Response) {
  resetNaturalReplyState();

  return res.status(200).json({
    ok: true,
    message: "Natural reply state reset.",
  });
}

export async function smokeAgentNaturalReply(req: Request, res: Response) {
  const message =
    typeof req.body?.message === "string"
      ? req.body.message
      : "صراحة غالية عليا";

  if (!message.trim()) {
    return res.status(400).json({
      message: "Message is required",
    });
  }

  try {
    const result = await smokeTestNaturalReply(message);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Natural reply smoke test failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function benchmarkAgentNaturalReply(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const result = await benchmarkNaturalReplies({ productContext });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Natural reply benchmark failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentSellerBrain(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (typeof testCase === "string") {
          return !testCase.trim();
        }

        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return typeof candidate.message !== "string" || !candidate.message.trim();
      });

      if (invalidCase) {
        return res.status(400).json({
          message:
            "Each seller brain eval case must be a message string or an object with message",
        });
      }
    }

    const normalizedCases = cases?.map((testCase) =>
      typeof testCase === "string"
        ? { message: testCase }
        : (testCase as SellerBrainEvalCase),
    );
    const report = await evaluateSellerBrain({
      productContext,
      cases: normalizedCases,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Seller brain evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentConversationScenarios(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const report = await evaluateConversationScenarios({ productContext });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Conversation scenario evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentContextualOrderUnderstanding(_req: Request, res: Response) {
  if (!isContextualOrderUnderstandingEvaluationEnabled(env.nodeEnv)) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    return res.status(200).json(await evaluateContextualOrderUnderstanding());
  } catch (error) {
    return res.status(500).json({
      message: "Contextual order understanding evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentInformationalAI(_req: Request, res: Response) {
  if (!isContextualOrderUnderstandingEvaluationEnabled(env.nodeEnv)) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    return res.status(200).json(await evaluateInformationalAIBoundary());
  } catch (error) {
    return res.status(500).json({
      message: "Informational AI boundary evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function listAgentOrders(req: Request, res: Response) {
  const status = getOptionalString(req.query.status);

  if (status && !isOrderStatus(status)) {
    return res.status(400).json({
      message: "Invalid order status",
      allowedStatuses: orderStatuses,
    });
  }

  return res.status(200).json({
    orders: listConfirmedOrders({
      status: status ? normalizeOrderStatus(status) : undefined,
      customerId: getOptionalString(req.query.customerId),
      phone: getOptionalString(req.query.phone),
      city: getOptionalString(req.query.city),
    }),
  });
}

export function getAgentOrder(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const order = id ? getConfirmedOrderById(id) : undefined;

  if (!order) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  return res.status(200).json({
    order,
  });
}

export function listAgentAdminNotifications(req: Request, res: Response) {
  const isRead = getOptionalBooleanQuery(req.query.isRead);
  const type = getOptionalString(req.query.type);

  if (isRead === "invalid") {
    return res.status(400).json({
      message: "isRead must be true or false",
    });
  }

  if (type && !isAdminNotificationType(type)) {
    return res.status(400).json({
      message: "Invalid notification type",
      allowedTypes: adminNotificationTypes,
    });
  }

  const notificationType: AdminNotificationType | undefined = type
    ? (type as AdminNotificationType)
    : undefined;

  return res.status(200).json({
    notifications: listAdminNotifications({
      isRead,
      type: notificationType,
      customerId: getOptionalString(req.query.customerId),
      orderId: getOptionalString(req.query.orderId),
    }),
  });
}

export function getAgentAdminNotification(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const notification = id ? getAdminNotificationById(id) : undefined;

  if (!notification) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    notification,
  });
}

export function markAgentAdminNotificationRead(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const notification = id ? markAdminNotificationRead(id) : undefined;

  if (!notification) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    notification,
  });
}

export function markAllAgentAdminNotificationsRead(_req: Request, res: Response) {
  return res.status(200).json({
    updatedCount: markAllAdminNotificationsRead(),
  });
}

export function deleteAgentAdminNotification(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const notification = id ? deleteAdminNotification(id) : undefined;

  if (!notification) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    notification,
  });
}

export function updateAgentOrderStatus(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const status = getOptionalString(req.body?.status);

  if (!status || !isOrderStatus(status)) {
    return res.status(400).json({
      message: "Invalid order status",
      allowedStatuses: orderStatuses,
    });
  }

  const order = id
    ? updateConfirmedOrderStatus(id, normalizeOrderStatus(status))
    : undefined;

  if (!order) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  return res.status(200).json({
    order,
  });
}
