import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_PRODUCT_CONTEXT } from "../default-product-context";
import { generateAgentResult } from "../agent.service";
import { clearConversationSession, getConversationSession } from "../session/conversation-session.service";
import { isInformationalAIEligible } from "./informational-ai-answer.service";

type EvaluationCheck = {
  name: string;
  passed: boolean;
  details?: string;
};

export type InformationalAIEvaluationReport = {
  summary: {
    total: number;
    passed: number;
    failed: number;
    acceptancePassed: boolean;
  };
  checks: EvaluationCheck[];
};

function stableOrderSnapshot(session: Awaited<ReturnType<typeof getConversationSession>>): string {
  return JSON.stringify({
    orderCycleId: session.orderState.orderCycleId,
    collected: session.orderState.collected,
    missingFields: session.orderState.missingFields,
    isComplete: session.orderState.isComplete,
    awaitingConfirmation: session.orderState.awaitingConfirmation,
    confirmed: session.orderState.confirmed,
  });
}

export async function evaluateInformationalAIBoundary(): Promise<InformationalAIEvaluationReport> {
  const checks: EvaluationCheck[] = [];
  const add = (name: string, passed: boolean, details?: string) => {
    checks.push({ name, passed, details });
  };
  const suffix = randomUUID().slice(0, 8);
  const sellerId = "seller_demo_sandals";
  const activeCustomer = `phase62-active-${suffix}`;
  const infoCustomer = `phase62-info-${suffix}`;
  const directCustomer = `phase62-direct-${suffix}`;
  const options = (customerId: string) => ({
    customerId,
    customerPhone: customerId,
    sellerId,
    useMemory: true,
    interactiveEnabledOverride: true,
  });

  try {
    let configuredFactGeneratorCalled = false;
    const configuredFact = await generateAgentResult(
      "شنو المادة ديالو؟",
      {
        ...DEFAULT_PRODUCT_CONTEXT,
        attributes: { المادة: "جلد طبيعي" },
      },
      undefined,
      {
        informationalAI: {
          enabledOverride: true,
          generateStructuredReply: async () => {
            configuredFactGeneratorCalled = true;
            throw new Error("Configured fact must not call AI");
          },
        },
      },
    );
    add(
      "configured product fact stays deterministic",
      configuredFact.meta?.aiUsed === false &&
        configuredFact.reply.includes("جلد طبيعي") &&
        !configuredFactGeneratorCalled,
    );

    await generateAgentResult(
      "first_entry:order_now",
      DEFAULT_PRODUCT_CONTEXT,
      options(activeCustomer),
    );
    await generateAgentResult(
      "size:38",
      DEFAULT_PRODUCT_CONTEXT,
      options(activeCustomer),
    );
    const activeBefore = await getConversationSession(activeCustomer, sellerId);
    const beforeSnapshot = stableOrderSnapshot(activeBefore);
    const positive = await generateAgentResult(
      "واش هاد الموديل مريح لشي واحد كيبقى واقف بزاف فالخدمة؟",
      DEFAULT_PRODUCT_CONTEXT,
      options(activeCustomer),
      {
        informationalAI: {
          enabledOverride: true,
          generateStructuredReply: async () =>
            JSON.stringify({
              answer: "المعلومة المؤكدة هي أن الصندالة مناسبة للاستعمال اليومي والخروج.",
              grounded: true,
            }),
        },
      },
    );
    const activeAfterPositive = await getConversationSession(activeCustomer, sellerId);

    add(
      "positive answer-only AI fallback is reachable",
      positive.meta?.informationalAIUsed === true &&
        positive.meta?.aiUsed === true &&
        positive.meta?.informationalAIValidationFailed === false &&
        positive.source === "ai_fallback",
      JSON.stringify({
        informationalAIUsed: positive.meta?.informationalAIUsed,
        aiUsed: positive.meta?.aiUsed,
        validationFailed: positive.meta?.informationalAIValidationFailed,
        reply: positive.reply,
      }),
    );
    add(
      "positive AI answer changes zero order fields",
      stableOrderSnapshot(activeAfterPositive) === beforeSnapshot &&
        positive.meta?.stateChangedFieldKeys?.length === 0,
    );
    add(
      "positive AI answer resumes awaited color prompt",
      activeAfterPositive.orderState.missingFields[0] === "color" &&
        positive.reply.includes("اللون") &&
        activeAfterPositive.orderState.orderCycleId === activeBefore.orderState.orderCycleId,
    );

    const timeout = await generateAgentResult(
      "واش هاد الموديل مريح لشي واحد كيبقى واقف بزاف فالخدمة؟",
      DEFAULT_PRODUCT_CONTEXT,
      options(activeCustomer),
      {
        informationalAI: {
          enabledOverride: true,
          generateStructuredReply: async () => {
            throw new Error("Structured Ollama request timed out after 10ms");
          },
        },
      },
    );
    const activeAfterTimeout = await getConversationSession(activeCustomer, sellerId);

    add(
      "AI timeout returns safe fallback",
      timeout.meta?.informationalAITimedOut === true &&
        timeout.reply.includes("ما قدرتش نأكد هاد المعلومة") &&
        timeout.reply.includes("اللون"),
    );
    add(
      "AI timeout preserves active order exactly",
      stableOrderSnapshot(activeAfterTimeout) === beforeSnapshot &&
        timeout.meta?.stateChangedFieldKeys?.length === 0,
    );

    const delivery = await generateAgentResult(
      "واش التوصيل متوفر؟",
      DEFAULT_PRODUCT_CONTEXT,
      options(activeCustomer),
    );
    const activeAfterDelivery = await getConversationSession(activeCustomer, sellerId);
    add(
      "known delivery question stays deterministic and resumes order",
      delivery.meta?.aiUsed === false &&
        delivery.reply.includes("التوصيل") &&
        delivery.reply.includes("اللون") &&
        stableOrderSnapshot(activeAfterDelivery) === beforeSnapshot,
    );

    const infoMenu = await generateAgentResult(
      "first_entry:more_info",
      DEFAULT_PRODUCT_CONTEXT,
      options(infoCustomer),
    );
    const sizes = await generateAgentResult(
      "info:sizes",
      DEFAULT_PRODUCT_CONTEXT,
      options(infoCustomer),
    );
    const selection = await generateAgentResult(
      "size:37",
      DEFAULT_PRODUCT_CONTEXT,
      options(infoCustomer),
    );
    const afterSelection = await getConversationSession(infoCustomer, sellerId);
    const selectionButtons =
      selection.meta?.whatsappInteractivePreview?.interactive.type === "button"
        ? selection.meta.whatsappInteractivePreview.interactive.action.buttons
        : [];

    add(
      "info exploration routes internal IDs without AI",
      infoMenu.meta?.aiUsed === false &&
        sizes.meta?.aiUsed === false &&
        selection.meta?.aiUsed === false,
    );
    add(
      "info size selection remains outside order draft",
      !afterSelection.orderState.orderCycleId &&
        afterSelection.orderState.collected.size === undefined &&
        afterSelection.productInfo?.pendingOrderSelections?.size === "37",
    );
    add(
      "info size selection shows Continue Order and More Information",
      selectionButtons.some((button) => button.reply.id === "info:continue_order") &&
        selectionButtons.some((button) => button.reply.id === "info:menu"),
    );

    const moreInfo = await generateAgentResult(
      "info:more_info",
      DEFAULT_PRODUCT_CONTEXT,
      options(infoCustomer),
    );
    const afterMoreInfo = await getConversationSession(infoCustomer, sellerId);
    add(
      "More Information preserves pending selection without order cycle",
      moreInfo.meta?.aiUsed === false &&
        !afterMoreInfo.orderState.orderCycleId &&
        afterMoreInfo.productInfo?.pendingOrderSelections?.size === "37" &&
        moreInfo.reply.includes("اختار"),
      JSON.stringify({
        cycle: afterMoreInfo.orderState.orderCycleId,
        pendingSize: afterMoreInfo.productInfo?.pendingOrderSelections?.size,
        reply: moreInfo.reply,
      }),
    );

    const continued = await generateAgentResult(
      "info:continue_order",
      DEFAULT_PRODUCT_CONTEXT,
      options(infoCustomer),
    );
    const afterContinue = await getConversationSession(infoCustomer, sellerId);
    add(
      "Continue Order creates fresh cycle and seeds pending size",
      Boolean(afterContinue.orderState.orderCycleId) &&
        afterContinue.orderState.collected.size === "37" &&
        afterContinue.orderState.missingFields[0] === "color" &&
        afterContinue.productInfo === undefined &&
        continued.reply.includes("اللون"),
      JSON.stringify({
        cycle: afterContinue.orderState.orderCycleId,
        size: afterContinue.orderState.collected.size,
        missingFields: afterContinue.orderState.missingFields,
        productInfo: afterContinue.productInfo,
        reply: continued.reply,
      }),
    );

    await generateAgentResult(
      "first_entry:order_now",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    await generateAgentResult(
      "size:38",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    await generateAgentResult(
      "color:أسود",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    await generateAgentResult(
      "1",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    const name = await generateAgentResult(
      "أسامة العزري",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    await generateAgentResult(
      "0612345678",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    const city = await generateAgentResult(
      "دوار النخيل الجديدة",
      DEFAULT_PRODUCT_CONTEXT,
      options(directCustomer),
    );
    const directSession = await getConversationSession(directCustomer, sellerId);
    add(
      "awaited name is accepted deterministically",
      name.meta?.aiUsed === false && directSession.orderState.collected.fullName === "أسامة العزري",
    );
    add(
      "unseen awaited city is accepted deterministically",
      city.meta?.aiUsed === false && directSession.orderState.collected.city === "دوار النخيل الجديدة",
    );

    const interactiveIds = [
      "first_entry:more_info",
      "info:sizes",
      "info:colors",
      "info:continue_order",
      "info:more_info",
      "size:37",
      "color:أسود",
      "field:skip:note",
      "order:confirm",
      "order:edit",
    ];
    add(
      "known interactive IDs are ineligible for AI",
      interactiveIds.every((id) => !isInformationalAIEligible(id)),
    );

    const strictShape = await generateAgentResult(
      "واش هاد الموديل مريح لشي واحد كيبقى واقف بزاف فالخدمة؟",
      DEFAULT_PRODUCT_CONTEXT,
      options(activeCustomer),
      {
        informationalAI: {
          enabledOverride: true,
          generateStructuredReply: async () =>
            JSON.stringify({
              answer: "الصندالة مناسبة للاستعمال اليومي.",
              grounded: true,
              entities: { color: "أسود" },
            }),
        },
      },
    );
    add(
      "answer-only schema rejects order entities",
      strictShape.meta?.informationalAIValidationFailed === true &&
        strictShape.reply.includes("ما قدرتش نأكد هاد المعلومة"),
    );

    const servicePath = resolve(
      process.cwd(),
      "src/modules/agent/info/informational-ai-answer.service.ts",
    );
    const source = await readFile(servicePath, "utf8");
    const forbiddenInvocationPattern = /(?:updateConversationOrderState|applyUnderstandingDecision|saveConfirmedOrder|resolveProductDeliveryQuote|generateOrderReceipt|sendMessage\s*\()/;
    const forbiddenImportPattern = /from\s+["'][^"']*(?:order-state|order-draft-mutation|delivery-pricing|confirmed-order|order-receipt|conversation-session|whatsapp)[^"']*["']/;
    add(
      "static answer-only boundary has no mutation pricing receipt persistence or dispatch dependency",
      !forbiddenInvocationPattern.test(source) && !forbiddenImportPattern.test(source),
    );
  } finally {
    await Promise.allSettled([
      clearConversationSession(activeCustomer, sellerId),
      clearConversationSession(infoCustomer, sellerId),
      clearConversationSession(directCustomer, sellerId),
    ]);
  }

  const passed = checks.filter((check) => check.passed).length;

  return {
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      acceptancePassed: passed === checks.length,
    },
    checks,
  };
}
