import { DEFAULT_PRODUCT_CONTEXT } from "./default-product-context";
import type {
  AgentAction,
  AgentOrderStateSummary,
  AgentResultSource,
  ChoiceListAction,
} from "./agent-action.types";
import { generateAgentResult } from "./agent.service";
import { listAdminNotifications } from "./admin/admin-notification.service";
import { listConfirmedOrders } from "./order/confirmed-order-store.service";
import { OLD_GENERIC_FALLBACK_REPLY } from "./sales/sales-response.builder";
import {
  clearConversationSession,
  getConversationSession,
  updateConversationOrderState,
} from "./session/conversation-session.service";
import type { ProductContext } from "./product-context.types";

type ScenarioMessageCheck = {
  name: string;
  passed: boolean;
  details?: string;
};

type ScenarioMessageResult = {
  user: string;
  reply: string;
  source: AgentResultSource;
  actions: AgentAction[];
  durationMs: number;
  sellerBrainReplyKey?: string;
  intentRouterUsedAI?: boolean;
  intentRouterTimedOut?: boolean;
  orderStateSummary?: AgentOrderStateSummary;
  checks: ScenarioMessageCheck[];
};

type ConversationScenarioResult = {
  name: string;
  passed: boolean;
  messages: ScenarioMessageResult[];
};

export type ConversationScenarioEvalReport = {
  summary: {
    totalScenarios: number;
    totalMessages: number;
    passed: boolean;
    failedScenarios: string[];
    avgDurationMs: number;
    maxDurationMs: number;
    genericFallbackCount: number;
    unsafeClaimCount: number;
    repeatedReplyCount: number;
    orderFlowPassed: boolean;
    confirmationPassed: boolean;
  };
  scenarios: ConversationScenarioResult[];
};

type ScenarioRunState = {
  runId: string;
  orderFlowCustomerId?: string;
  orderFlowPassed?: boolean;
  confirmationPassed?: boolean;
};

const unsafeClaimTerms = [
  "توصيل مجاني",
  "livraison gratuite",
  "free delivery",
  "الأكثر مبيعا",
  "الأكثر مبيعاً",
  "best seller",
  "خصم",
  "آراء الزبناء كاينة",
  "reviews available",
];

function hasUnsafeClaim(reply: string): boolean {
  const lowerReply = reply.toLowerCase();

  if (
    lowerReply.includes("ما نقدرش نأكد تخفيض") ||
    lowerReply.includes("ما عنديش إحصائية") ||
    lowerReply.includes("بلا إحصائية")
  ) {
    return false;
  }

  return unsafeClaimTerms.some((term) =>
    lowerReply.includes(term.toLowerCase()),
  );
}

function hasOldGenericFallback(reply: string): boolean {
  return reply.trim() === OLD_GENERIC_FALLBACK_REPLY;
}

function hasUnavailableColorRejection(reply: string): boolean {
  return (
    reply.includes("ما متوفرش") ||
    reply.includes("ما كاينش") ||
    reply.includes("ما متوفراش")
  );
}

function hasSafeClarification(reply: string): boolean {
  return (
    reply.includes("ما فهمتش") ||
    reply.includes("نوضح") ||
    reply.includes("قولي لي") ||
    reply.includes("نقدر نعاونك")
  );
}

async function getOrderSummary(customerId: string): Promise<AgentOrderStateSummary> {
  const session = await getConversationSession(customerId);

  return {
    isComplete: session.orderState.isComplete,
    awaitingConfirmation: session.orderState.awaitingConfirmation,
    confirmed: session.orderState.confirmed,
    missingFields: session.orderState.missingFields,
  };
}

async function runMessage(input: {
  customerId: string;
  message: string;
  productContext: ProductContext;
  checks?: (result: ScenarioMessageResult) => ScenarioMessageCheck[];
}): Promise<ScenarioMessageResult> {
  const result = await generateAgentResult(input.message, input.productContext, {
    customerId: input.customerId,
    useMemory: true,
  });
  const durationMs = result.meta?.durationMs ?? 0;
  const baseResult: ScenarioMessageResult = {
    user: input.message,
    reply: result.reply,
    source: result.source,
    actions: result.actions,
    durationMs,
    sellerBrainReplyKey: result.meta?.sellerBrainReplyKey,
    intentRouterUsedAI: result.meta?.intentRouterUsedAI,
    intentRouterTimedOut: result.meta?.intentRouterTimedOut,
    orderStateSummary: result.meta?.orderStateSummary,
    checks: [],
  };
  const commonChecks: ScenarioMessageCheck[] = [
    {
      name: "not_old_generic_fallback",
      passed: !hasOldGenericFallback(result.reply),
    },
    {
      name: "no_unsafe_claim",
      passed: !hasUnsafeClaim(result.reply),
    },
    {
      name: "fast_deterministic",
      passed: durationMs <= 200,
      details: `${durationMs}ms`,
    },
    {
      name: "no_router_timeout",
      passed: result.meta?.intentRouterTimedOut !== true,
    },
  ];

  return {
    ...baseResult,
    checks: [...commonChecks, ...(input.checks?.(baseResult) || [])],
  };
}

async function runScenario(input: {
  name: string;
  customerId: string;
  productContext: ProductContext;
  messages: Array<{
    text: string;
    checks?: (result: ScenarioMessageResult) => ScenarioMessageCheck[];
  }>;
}): Promise<ConversationScenarioResult> {
  const messages: ScenarioMessageResult[] = [];

  await clearConversationSession(input.customerId);

  for (const message of input.messages) {
    messages.push(
      await runMessage({
        customerId: input.customerId,
        message: message.text,
        productContext: input.productContext,
        checks: message.checks,
      }),
    );
  }

  return {
    name: input.name,
    passed: messages.every((message) =>
      message.checks.every((check) => check.passed),
    ),
    messages,
  };
}

async function runSalesDiscoveryScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  return runScenario({
    name: "Sales discovery",
    customerId: `scenario-sales-${state.runId}`,
    productContext,
    messages: [
      { text: "سلام" },
      { text: "شنو كتبيعو" },
      { text: "bch7al hadi" },
      { text: "Ina alwan kaynin" },
      {
        text: "Brayt lon sfar",
        checks: (result) => [
          {
            name: "yellow_rejected",
            passed: hasUnavailableColorRejection(result.reply),
          },
        ],
      },
      { text: "صراحة غالية عليا" },
      { text: "واش ماشي نصابة" },
      { text: "راني محتارة شنو ناخد" },
    ],
  });
}

async function runOrderFlowScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-order-${state.runId}`;
  state.orderFlowCustomerId = customerId;
  const scenario = await runScenario({
    name: "Order flow with unavailable color",
    customerId,
    productContext,
    messages: [
      { text: "bghit wahda 38 casa" },
      { text: "سارة 0612345678 حي النصر" },
      {
        text: "أبيض",
        checks: (result) => [
          {
            name: "white_rejected",
            passed: hasUnavailableColorRejection(result.reply),
          },
          {
            name: "white_not_collected",
            passed: result.orderStateSummary?.isComplete === false,
          },
        ],
      },
      {
        text: "أسود",
        checks: (result) => [
          {
            name: "order_complete",
            passed: result.orderStateSummary?.isComplete === true,
          },
          {
            name: "awaiting_confirmation",
            passed: result.orderStateSummary?.awaitingConfirmation === true,
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);
  const collectedColor = session.orderState.collected.color;
  const orderStateOk =
    session.orderState.isComplete &&
    session.orderState.awaitingConfirmation &&
    !session.orderState.confirmed &&
    collectedColor === "أسود";
  const whiteNotAccepted = collectedColor !== "أبيض";

  state.orderFlowPassed = orderStateOk && whiteNotAccepted;
  scenario.passed = scenario.passed && state.orderFlowPassed;

  return scenario;
}

async function runOrderConfirmationScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = state.orderFlowCustomerId || `scenario-order-${state.runId}`;
  const messages: ScenarioMessageResult[] = [];
  const beforeOrders = listConfirmedOrders({ customerId }).length;
  const beforeNotifications = listAdminNotifications({ customerId }).length;

  messages.push(
    await runMessage({
      customerId,
      message: "نعم",
      productContext,
      checks: (result) => [
        {
          name: "confirmed",
          passed: result.orderStateSummary?.confirmed === true,
        },
      ],
    }),
  );
  messages.push(
    await runMessage({
      customerId,
      message: "نعم",
      productContext,
      checks: (result) => [
        {
          name: "already_confirmed_reply",
          passed: result.reply.includes("تأكد من قبل"),
        },
      ],
    }),
  );

  const afterOrders = listConfirmedOrders({ customerId }).length;
  const afterNotifications = listAdminNotifications({ customerId }).length;
  const orderSavedOnce = afterOrders - beforeOrders === 1;
  const notificationCreatedOnce = afterNotifications - beforeNotifications === 1;
  const summary = await getOrderSummary(customerId);

  state.confirmationPassed =
    orderSavedOnce &&
    notificationCreatedOnce &&
    summary.confirmed &&
    !summary.awaitingConfirmation;

  messages[messages.length - 1].checks.push(
    {
      name: "order_saved_once",
      passed: orderSavedOnce,
      details: `${beforeOrders}->${afterOrders}`,
    },
    {
      name: "notification_created_once",
      passed: notificationCreatedOnce,
      details: `${beforeNotifications}->${afterNotifications}`,
    },
  );

  return {
    name: "Order confirmation",
    passed:
      state.confirmationPassed &&
      messages.every((message) =>
        message.checks.every((check) => check.passed),
      ),
    messages,
  };
}

async function runRepetitionScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-repeat-${state.runId}`;
  const scenario = await runScenario({
    name: "Repetition memory",
    customerId,
    productContext,
    messages: [
      { text: "صراحة غالية عليا" },
      { text: "صراحة غالية عليا" },
      { text: "صراحة غالية عليا" },
    ],
  });
  const seenKeys = new Set<string>();

  for (const message of scenario.messages) {
    const replyKey = message.sellerBrainReplyKey;
    const repeated = Boolean(replyKey && seenKeys.has(replyKey));

    if (replyKey) {
      seenKeys.add(replyKey);
    }

    message.checks.push({
      name: "seller_brain_reply_key_rotates",
      passed: !repeated,
      details: replyKey,
    });
  }

  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runUnknownScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  return runScenario({
    name: "Unknown/off-topic",
    customerId: `scenario-unknown-${state.runId}`,
    productContext,
    messages: [
      {
        text: "شنو رأيك فالماتش؟",
        checks: (result) => [
          {
            name: "safe_clarification",
            passed: hasSafeClarification(result.reply),
          },
        ],
      },
      {
        text: "???",
        checks: (result) => [
          {
            name: "safe_clarification",
            passed: hasSafeClarification(result.reply),
          },
        ],
      },
    ],
  });
}

async function runWhatsappTypoRuntimeScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  return runScenario({
    name: "WhatsApp typo sales/order runtime",
    customerId: `scenario-whatsapp-typo-${state.runId}`,
    productContext,
    messages: [
      {
        text: "Bach7l hadi",
        checks: (result) => [
          {
            name: "price_reply",
            passed:
              result.source === "seller_brain" && result.reply.includes("179"),
          },
          {
            name: "router_did_not_use_ai",
            passed: result.intentRouterUsedAI === false,
          },
        ],
      },
      {
        text: "اك تقد تصوب لي كومند ديالي",
        checks: (result) => [
          {
            name: "entered_order_flow",
            passed:
              result.orderStateSummary?.isComplete === false &&
              result.orderStateSummary.missingFields.length > 0,
          },
          {
            name: "asks_order_fields",
            passed:
              result.reply.includes("الاسم الكامل") &&
              result.reply.includes("رقم الهاتف") &&
              result.reply.includes("المدينة") &&
              result.reply.includes("العنوان") &&
              result.reply.includes("المقاس") &&
              result.reply.includes("اللون"),
          },
        ],
      },
      {
        text: "الطلب",
        checks: (result) => [
          {
            name: "stays_order_flow",
            passed:
              result.orderStateSummary?.isComplete === false &&
              result.orderStateSummary.missingFields.length > 0,
          },
          {
            name: "asks_order_fields",
            passed:
              result.reply.includes("الاسم الكامل") &&
              result.reply.includes("رقم الهاتف") &&
              result.reply.includes("المدينة") &&
              result.reply.includes("العنوان") &&
              result.reply.includes("المقاس") &&
              result.reply.includes("اللون"),
          },
        ],
      },
    ],
  });
}

function findSizeChoiceAction(
  result: ScenarioMessageResult,
): ChoiceListAction | undefined {
  return result.actions.find(
    (action): action is ChoiceListAction =>
      action.type === "choice_list" && action.choiceType === "size",
  );
}

function hasDefaultSizeOptions(result: ScenarioMessageResult): boolean {
  const action = findSizeChoiceAction(result);
  const optionLabels =
    action?.options.map((option) => option.label).sort().join(",") || "";

  return optionLabels === ["36", "37", "38", "39", "40"].sort().join(",");
}

async function runSizeChoiceListScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  return runScenario({
    name: "Size choice list",
    customerId: `scenario-size-choice-${state.runId}`,
    productContext,
    messages: [
      {
        text: "شنو المقاسات؟",
        checks: (result) => [
          {
            name: "has_size_choice_list",
            passed: Boolean(findSizeChoiceAction(result)),
          },
          {
            name: "has_default_size_options",
            passed: hasDefaultSizeOptions(result),
          },
          {
            name: "has_fallback_text",
            passed: Boolean(findSizeChoiceAction(result)?.fallbackText),
          },
        ],
      },
    ],
  });
}

async function runOrderMissingSizeChoiceScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  return runScenario({
    name: "Order missing size choice",
    customerId: `scenario-order-missing-size-${state.runId}`,
    productContext,
    messages: [
      {
        text: "بغيت نكوموندي",
        checks: (result) => [
          {
            name: "order_flow_started",
            passed:
              result.orderStateSummary?.isComplete === false &&
              result.orderStateSummary.missingFields.includes("size"),
          },
          {
            name: "has_size_choice_list",
            passed: Boolean(findSizeChoiceAction(result)),
          },
        ],
      },
    ],
  });
}

async function runSelectedSizeScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-selected-size-${state.runId}`;
  const scenario = await runScenario({
    name: "Selected size",
    customerId,
    productContext,
    messages: [
      { text: "bghit wahda casa" },
      {
        text: "38",
        checks: (result) => [
          {
            name: "size_removed_from_missing_fields",
            passed:
              result.orderStateSummary?.missingFields.includes("size") === false,
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);

  scenario.messages[scenario.messages.length - 1].checks.push({
    name: "size_collected",
    passed: session.orderState.collected.size === "38",
    details: session.orderState.collected.size,
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runSelectedSizeIdScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-selected-size-id-${state.runId}`;
  const scenario = await runScenario({
    name: "Selected size from interactive id",
    customerId,
    productContext,
    messages: [
      { text: "بغيت نكوموندي" },
      {
        text: "size:36",
        checks: (result) => [
          {
            name: "size_removed_from_missing_fields",
            passed:
              result.orderStateSummary?.missingFields.includes("size") === false,
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);

  scenario.messages[scenario.messages.length - 1].checks.push({
    name: "size_id_collected",
    passed: session.orderState.collected.size === "36",
    details: session.orderState.collected.size,
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runActiveOrderAsksSizesScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-active-order-sizes-${state.runId}`;
  const scenario = await runScenario({
    name: "Active order asks sizes while address missing",
    customerId,
    productContext,
    messages: [
      { text: "bghit wahda 38 casa" },
      { text: "اسامة 0612345678" },
      { text: "أسود" },
      {
        text: "المقاسات",
        checks: (result) => [
          {
            name: "mentions_current_size",
            passed: result.reply.includes("38"),
          },
          {
            name: "mentions_available_sizes",
            passed:
              result.reply.includes("36") &&
              result.reply.includes("37") &&
              result.reply.includes("39") &&
              result.reply.includes("40"),
          },
          {
            name: "reminds_address",
            passed: result.reply.includes("العنوان"),
          },
          {
            name: "has_change_size_choice_list",
            passed: findSizeChoiceAction(result)?.context === "change_size",
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);
  const latestAgentMessage = [...session.messages]
    .reverse()
    .find((message) => message.role === "agent");
  const finalMessage = scenario.messages[scenario.messages.length - 1];
  const stateOk =
    session.orderState.collected.size === "38" &&
    session.orderState.collected.color === "أسود" &&
    session.orderState.missingFields.includes("address") &&
    !session.orderState.isComplete;

  scenario.messages[scenario.messages.length - 1].checks.push({
    name: "order_state_preserved",
    passed: stateOk,
    details: JSON.stringify(session.orderState),
  });
  finalMessage.checks.push({
    name: "session_latest_agent_message_matches_final_reply",
    passed: latestAgentMessage?.text === finalMessage.reply,
    details: JSON.stringify({
      saved: latestAgentMessage?.text,
      returned: finalMessage.reply,
    }),
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runCasablancaNoSpaceCityScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-casablanca-nospace-${state.runId}`;
  const scenario = await runScenario({
    name: "Casablanca no-space city is not white color",
    customerId,
    productContext,
    messages: [
      { text: "بغيت نكوموندي" },
      { text: "36" },
      { text: "عمر العزري" },
      { text: "0611581667" },
      {
        text: "الدارالبيضاء",
        checks: (result) => [
          {
            name: "city_removed_from_missing_fields",
            passed:
              result.orderStateSummary?.missingFields.includes("city") === false,
          },
          {
            name: "does_not_reject_white",
            passed: !hasUnavailableColorRejection(result.reply),
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);
  const stateOk =
    session.orderState.collected.city === "الدار البيضاء" &&
    !session.orderState.collected.color &&
    session.orderState.missingFields.includes("color");

  scenario.messages[scenario.messages.length - 1].checks.push({
    name: "city_collected_color_not_collected",
    passed: stateOk,
    details: JSON.stringify(session.orderState),
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runAddressAndQuantitySameMessageScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-address-quantity-${state.runId}`;
  const scenario = await runScenario({
    name: "Address and quantity same message",
    customerId,
    productContext,
    messages: [
      { text: "بغيت نكوموندي" },
      { text: "36" },
      { text: "عمر العزري" },
      { text: "0611581667" },
      { text: "الدارالبيضاء" },
      { text: "وردي" },
      {
        text: "العنوان حي السلام 2 الكمية 1",
        checks: (result) => [
          {
            name: "order_complete",
            passed: result.orderStateSummary?.isComplete === true,
          },
          {
            name: "awaiting_confirmation",
            passed: result.orderStateSummary?.awaitingConfirmation === true,
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);
  const stateOk =
    session.orderState.collected.address === "حي السلام 2" &&
    session.orderState.collected.quantity === 1 &&
    !session.orderState.missingFields.includes("address") &&
    !session.orderState.missingFields.includes("quantity");

  scenario.messages[scenario.messages.length - 1].checks.push({
    name: "address_and_quantity_collected",
    passed: stateOk,
    details: JSON.stringify(session.orderState),
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runUnavailableColorNotStoredScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-unavailable-color-${state.runId}`;
  const scenario = await runScenario({
    name: "Unavailable color is not stored",
    customerId,
    productContext,
    messages: [
      { text: "bghit wahda 38 casa" },
      { text: "اسامة 0612345678" },
      {
        text: "أبيض",
        checks: (result) => [
          {
            name: "white_rejected",
            passed:
              result.reply.includes("ما متوفرش") ||
              result.reply.includes("ما كاينش"),
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);
  const colorNotStored =
    !session.orderState.collected.color &&
    session.orderState.missingFields.includes("color") &&
    !session.orderState.isComplete;

  scenario.messages[scenario.messages.length - 1].checks.push({
    name: "unavailable_color_not_stored",
    passed: colorNotStored,
    details: JSON.stringify(session.orderState),
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runSelectedSizeWithoutActiveOrderScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-size-without-order-${state.runId}`;
  const scenario = await runScenario({
    name: "Selected size without active order",
    customerId,
    productContext,
    messages: [
      {
        text: "38",
        checks: (result) => [
          {
            name: "size_available_reply",
            passed:
              result.reply.includes("38") &&
              (result.reply.includes("متوفر") || result.reply.includes("كاين")),
          },
          {
            name: "does_not_start_full_order",
            passed:
              !result.orderStateSummary?.missingFields.length &&
              !result.reply.includes("الاسم الكامل") &&
              !result.reply.includes("رقم الهاتف"),
          },
        ],
      },
    ],
  });
  const session = await getConversationSession(customerId);

  scenario.messages[0].checks.push({
    name: "order_state_not_started",
    passed:
      Object.keys(session.orderState.collected).length === 0 &&
      session.orderState.missingFields.length === 0,
    details: JSON.stringify(session.orderState),
  });
  scenario.passed = scenario.messages.every((message) =>
    message.checks.every((check) => check.passed),
  );

  return scenario;
}

async function runStaleUnavailableColorSanitizerScenario(
  state: ScenarioRunState,
  productContext: ProductContext,
): Promise<ConversationScenarioResult> {
  const customerId = `scenario-stale-color-${state.runId}`;

  await clearConversationSession(customerId);
  await updateConversationOrderState({
    customerId,
    collected: {
      fullName: "سارة",
      phone: "0612345678",
      city: "الدار البيضاء",
      address: "حي السلام",
      size: "38",
      color: "أبيض",
      quantity: 1,
    },
    missingFields: [],
    isComplete: true,
    awaitingConfirmation: true,
    confirmed: false,
  });

  const message = await runMessage({
    customerId,
    message: "واخا",
    productContext,
    checks: (result) => [
      {
        name: "does_not_confirm_with_stale_color",
        passed: result.orderStateSummary?.confirmed === false,
      },
      {
        name: "color_is_missing_again",
        passed:
          result.orderStateSummary?.missingFields.includes("color") === true,
      },
    ],
  });
  const session = await getConversationSession(customerId);
  const stateOk =
    !session.orderState.collected.color &&
    session.orderState.missingFields.includes("color") &&
    !session.orderState.isComplete &&
    !session.orderState.awaitingConfirmation &&
    !session.orderState.confirmed;

  message.checks.push({
    name: "stale_unavailable_color_removed",
    passed: stateOk,
    details: JSON.stringify(session.orderState),
  });

  return {
    name: "Stale unavailable color sanitizer",
    passed: message.checks.every((check) => check.passed),
    messages: [message],
  };
}

export async function evaluateConversationScenarios(input: {
  productContext?: ProductContext;
} = {}): Promise<ConversationScenarioEvalReport> {
  const productContext = input.productContext || DEFAULT_PRODUCT_CONTEXT;
  const state: ScenarioRunState = {
    runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const scenarios: ConversationScenarioResult[] = [];

  scenarios.push(await runSalesDiscoveryScenario(state, productContext));
  scenarios.push(await runOrderFlowScenario(state, productContext));
  scenarios.push(await runOrderConfirmationScenario(state, productContext));
  scenarios.push(await runRepetitionScenario(state, productContext));
  scenarios.push(await runUnknownScenario(state, productContext));
  scenarios.push(await runWhatsappTypoRuntimeScenario(state, productContext));
  scenarios.push(await runSizeChoiceListScenario(state, productContext));
  scenarios.push(await runOrderMissingSizeChoiceScenario(state, productContext));
  scenarios.push(await runSelectedSizeScenario(state, productContext));
  scenarios.push(await runSelectedSizeIdScenario(state, productContext));
  scenarios.push(await runActiveOrderAsksSizesScenario(state, productContext));
  scenarios.push(await runCasablancaNoSpaceCityScenario(state, productContext));
  scenarios.push(await runAddressAndQuantitySameMessageScenario(state, productContext));
  scenarios.push(await runUnavailableColorNotStoredScenario(state, productContext));
  scenarios.push(await runSelectedSizeWithoutActiveOrderScenario(state, productContext));
  scenarios.push(await runStaleUnavailableColorSanitizerScenario(state, productContext));

  const allMessages = scenarios.flatMap((scenario) => scenario.messages);
  const failedScenarios = scenarios
    .filter((scenario) => !scenario.passed)
    .map((scenario) => scenario.name);
  const genericFallbackCount = allMessages.filter((message) =>
    hasOldGenericFallback(message.reply),
  ).length;
  const unsafeClaimCount = allMessages.filter((message) =>
    hasUnsafeClaim(message.reply),
  ).length;
  const repeatedReplyCount = allMessages.filter((message) =>
    message.checks.some(
      (check) => check.name === "seller_brain_reply_key_rotates" && !check.passed,
    ),
  ).length;
  const maxDurationMs = allMessages.length
    ? Math.max(...allMessages.map((message) => message.durationMs))
    : 0;
  const avgDurationMs = allMessages.length
    ? Number(
        (
          allMessages.reduce((sum, message) => sum + message.durationMs, 0) /
          allMessages.length
        ).toFixed(1),
      )
    : 0;
  const passed =
    failedScenarios.length === 0 &&
    genericFallbackCount === 0 &&
    unsafeClaimCount === 0 &&
    repeatedReplyCount === 0 &&
    Boolean(state.orderFlowPassed) &&
    Boolean(state.confirmationPassed) &&
    maxDurationMs <= 200;

  return {
    summary: {
      totalScenarios: scenarios.length,
      totalMessages: allMessages.length,
      passed,
      failedScenarios,
      avgDurationMs,
      maxDurationMs,
      genericFallbackCount,
      unsafeClaimCount,
      repeatedReplyCount,
      orderFlowPassed: Boolean(state.orderFlowPassed),
      confirmationPassed: Boolean(state.confirmationPassed),
    },
    scenarios,
  };
}
