import { env } from "../../../../config/env";
import {
  buildSimulatedIncomingWebhook,
  processCloudWebhookBody,
} from "../../../whatsapp/cloud/whatsapp-cloud.service";
import { productContextService } from "../../config/product-context.service";
import { conversationKeyService } from "../../identity/conversation-key.service";
import {
  clearConversationSession,
  getConversationSession,
  updateConversationOrderState,
  updateConversationProductInfoState,
} from "../../session/conversation-session.service";
import { getOrderRuntimeReadiness } from "./order-runtime-router.service";
import { resetOrderRuntimeConversation } from "./order-runtime-session.service";
import type { OrderRuntimeSession } from "./order-runtime.types";

type Assertion = {
  name: string;
  passed: boolean;
  detail?: string;
};

type EvaluationScope = {
  sellerId: string;
  customerPhone: string;
  phoneNumberId: string;
  productId: string;
  conversationKey: string;
};

type WebhookResult = Awaited<ReturnType<typeof processCloudWebhookBody>>;

export type OrderRuntimeWebhookEvaluationReport = {
  phase: "6.3H2-R1";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  realValkey: boolean;
  noLiveSend: true;
  blocker?: string;
  assertions: Assertion[];
  scenario: {
    sellerId?: string;
    customerRef?: string;
  };
};

const PHASE = "6.3H2-R1" as const;

function maskRef(value: string): string {
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function add(
  assertions: Assertion[],
  name: string,
  passed: boolean,
  detail?: string,
): void {
  assertions.push({ name, passed, ...(passed ? {} : { detail }) });
}

function makeScope(
  sellerId: string,
  customerPhone: string,
  phoneNumberId: string,
): EvaluationScope {
  return {
    sellerId,
    customerPhone,
    phoneNumberId,
    productId: productContextService.getActiveProductContext(sellerId).productId,
    conversationKey: conversationKeyService.buildConversationKey(
      sellerId,
      customerPhone,
    ),
  };
}

function configuredScope(): EvaluationScope | undefined {
  const sellerId = env.firstEntryLiveSmokeSellerId.trim();
  const customerPhone = env.firstEntryLiveSmokeTestRecipient.replace(/\D/g, "");
  const phoneNumberId = env.whatsappCloudPhoneNumberId.trim();

  if (!sellerId || !customerPhone || !phoneNumberId) {
    return undefined;
  }

  return makeScope(sellerId, customerPhone, phoneNumberId);
}

function siblingPhone(phone: string, suffix: string): string {
  return `${phone.slice(0, -1)}${phone.endsWith(suffix) ? "7" : suffix}`;
}

async function loadSession(scope: EvaluationScope) {
  return getConversationSession(
    scope.conversationKey,
    scope.sellerId,
    scope.productId,
    scope.customerPhone,
  );
}

async function loadRuntime(scope: EvaluationScope): Promise<{
  orderRuntime?: OrderRuntimeSession;
  orderState: Awaited<ReturnType<typeof loadSession>>["orderState"];
  firstEntry?: Awaited<ReturnType<typeof loadSession>>["firstEntry"];
  productInfo?: Awaited<ReturnType<typeof loadSession>>["productInfo"];
}> {
  const session = await loadSession(scope);

  return {
    orderRuntime: session.orderRuntime as OrderRuntimeSession | undefined,
    orderState: session.orderState,
    firstEntry: session.firstEntry,
    productInfo: session.productInfo,
  };
}

function legacyFingerprint(
  orderState: Awaited<ReturnType<typeof loadRuntime>>["orderState"],
): string {
  return JSON.stringify({
    collected: orderState.collected,
    missingFields: orderState.missingFields,
    isComplete: orderState.isComplete,
    awaitingConfirmation: orderState.awaitingConfirmation,
    confirmed: orderState.confirmed,
    orderCycleId: orderState.orderCycleId,
  });
}

async function resetFullScope(scope: EvaluationScope): Promise<boolean> {
  return resetOrderRuntimeConversation(scope);
}

async function receiveWebhook(
  results: WebhookResult[],
  input: {
    scope: EvaluationScope;
    text?: string;
    buttonReplyId?: string;
    buttonReplyTitle?: string;
  },
): Promise<WebhookResult> {
  const result = await processCloudWebhookBody(
    buildSimulatedIncomingWebhook({
      from: input.scope.customerPhone,
      phoneNumberId: input.scope.phoneNumberId,
      text: input.text,
      buttonReplyId: input.buttonReplyId,
      buttonReplyTitle: input.buttonReplyTitle,
    }),
    { forceDryRun: true },
  );
  results.push(result);
  return result;
}

function actionIds(result: WebhookResult): string[] {
  return result.outboundMessages.flatMap((message) => message.actionIds);
}

function hasAllFieldsPrompt(text: string | undefined): boolean {
  const cleanText = text || "";
  const labels = ["الاسم", "الهاتف", "المدينة", "العنوان", "المقاس", "اللون"];
  return labels.filter((label) => cleanText.includes(label)).length >= 5;
}

async function seedLegacyConfirmed(scope: EvaluationScope): Promise<void> {
  await updateConversationOrderState({
    customerId: scope.conversationKey,
    customerPhone: scope.customerPhone,
    conversationKey: scope.conversationKey,
    sellerId: scope.sellerId,
    productId: scope.productId,
    orderCycleId: "legacy-h2-r1-cycle",
    collected: {
      fullName: "Legacy Test",
      phone: "0600000000",
      city: "Legacy City",
      address: "Legacy Address",
      size: "38",
      color: "وردي",
      quantity: 3,
    },
    missingFields: [],
    isComplete: true,
    awaitingConfirmation: false,
    confirmed: true,
  });
}

async function seedInfoMarker(scope: EvaluationScope): Promise<void> {
  await updateConversationProductInfoState({
    customerId: scope.conversationKey,
    customerPhone: scope.customerPhone,
    conversationKey: scope.conversationKey,
    sellerId: scope.sellerId,
    productId: scope.productId,
    lastTopic: "price",
    pendingSelection: "size",
  });
}

/**
 * Permanent H2-R1 boundary evaluator. It uses the real inbound mapper,
 * commercial First Entry, information service, AgentService, guarded runtime,
 * and Valkey session abstraction. Every outbound dispatch is forced dry-run.
 */
export async function evaluateOrderRuntimeWebhookIntegration(): Promise<OrderRuntimeWebhookEvaluationReport> {
  const assertions: Assertion[] = [];
  const webhookResults: WebhookResult[] = [];
  const scope = configuredScope();

  if (!scope) {
    add(
      assertions,
      "configured guarded webhook scope is available",
      false,
      "Missing seller, recipient, or phone number configuration.",
    );
    return {
      phase: PHASE,
      total: assertions.length,
      passed: 0,
      failed: assertions.length,
      strictAcceptance: false,
      realValkey: false,
      noLiveSend: true,
      blocker: "Configured guarded webhook scope is unavailable.",
      assertions,
      scenario: {},
    };
  }

  const readiness = await getOrderRuntimeReadiness(scope.sellerId, true);
  if (!readiness.valkeyReady || !readiness.flowEnabled) {
    add(
      assertions,
      "real Valkey-backed guarded runtime is ready",
      false,
      readiness.reason || "Runtime readiness failed.",
    );
    return {
      phase: PHASE,
      total: assertions.length,
      passed: 0,
      failed: assertions.length,
      strictAcceptance: false,
      realValkey: readiness.valkeyReady,
      noLiveSend: true,
      blocker: readiness.reason || "Guarded runtime is not ready.",
      assertions,
      scenario: {
        sellerId: scope.sellerId,
        customerRef: maskRef(scope.customerPhone),
      },
    };
  }

  const otherCustomerScope = makeScope(
    scope.sellerId,
    siblingPhone(scope.customerPhone, "8"),
    scope.phoneNumberId,
  );
  const otherSellerScope = makeScope(
    "seller_demo_medical",
    scope.customerPhone,
    scope.phoneNumberId,
  );

  await resetFullScope(scope);
  await clearConversationSession(
    otherCustomerScope.conversationKey,
    otherCustomerScope.sellerId,
    otherCustomerScope.productId,
  );
  await clearConversationSession(
    otherSellerScope.conversationKey,
    otherSellerScope.sellerId,
    otherSellerScope.productId,
  );

  try {
    await seedInfoMarker(otherCustomerScope);
    await seedInfoMarker(otherSellerScope);

    // Seed every target flow marker, then prove the explicit reset is complete
    // and isolated to one seller/customer key.
    await receiveWebhook(webhookResults, { scope, text: "سلام" });
    await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "first_entry:more_info",
      buttonReplyTitle: "المزيد من المعلومات",
    });
    await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "info:order_now",
      buttonReplyTitle: "أطلب الآن",
    });
    await seedLegacyConfirmed(scope);
    await resetFullScope(scope);

    let state = await loadRuntime(scope);
    const otherCustomerAfterReset = await loadRuntime(otherCustomerScope);
    const otherSellerAfterReset = await loadRuntime(otherSellerScope);
    add(
      assertions,
      "scoped full reset clears runtime, legacy, First Entry, and info state",
      !state.orderRuntime &&
        !state.firstEntry &&
        !state.productInfo &&
        state.orderState.confirmed === false &&
        Object.keys(state.orderState.collected).length === 0,
    );
    add(
      assertions,
      "scoped reset leaves another customer unchanged",
      otherCustomerAfterReset.productInfo?.lastTopic === "price" &&
        otherCustomerAfterReset.productInfo.pendingSelection === "size",
    );
    add(
      assertions,
      "scoped reset leaves the same customer under another seller unchanged",
      otherSellerAfterReset.productInfo?.lastTopic === "price" &&
        otherSellerAfterReset.productInfo.pendingSelection === "size",
    );

    const product = productContextService.getActiveProductContext(scope.sellerId);
    const greeting = await receiveWebhook(webhookResults, { scope, text: "سلام" });
    state = await loadRuntime(scope);
    const firstMessage = greeting.outboundMessages[0];
    const secondMessage = greeting.outboundMessages[1];
    const firstEntryActions = secondMessage?.actionIds || [];

    add(assertions, "real-shaped greeting enters commercial First Entry", greeting.handled && greeting.sendSuccess && state.firstEntry?.shown === true);
    add(assertions, "greeting does not initialize Phase 6.3", !state.orderRuntime);
    add(assertions, "First Entry emits exactly two outbound messages", greeting.outboundMessages.length === 2);
    add(assertions, "First Entry message 1 is text-only", firstMessage?.kind === "text" && firstMessage.actionIds.length === 0);
    add(assertions, "commercial message uses configured product name", Boolean(firstMessage?.text.includes(product.name)));
    add(assertions, "commercial message uses configured product price", Boolean(firstMessage?.text.includes(String(product.price))));
    add(assertions, "commercial message includes configured delivery information", Boolean(firstMessage?.text.includes("التوصيل")));
    add(assertions, "compact commercial message omits duplicate payment information", !firstMessage?.text.includes("الدفع"));
    add(assertions, "commercial message does not collect order fields", !hasAllFieldsPrompt(firstMessage?.text));
    add(assertions, "First Entry message 2 is a separate interactive CTA", secondMessage?.kind === "interactive" && secondMessage.text !== firstMessage?.text);
    add(assertions, "First Entry CTA has exactly the two authoritative actions", firstEntryActions.length === 2 && firstEntryActions[0] === "first_entry:order_now" && firstEntryActions[1] === "first_entry:more_info");
    add(assertions, "commercial content is not merged into CTA message", !secondMessage?.text.includes(product.name) && !secondMessage?.text.includes(String(product.price)));
    add(assertions, "First Entry is not duplicated", greeting.outboundMessages.filter((message) => message.text.includes(product.name)).length === 1);

    const orderBeforeInfo = legacyFingerprint(state.orderState);
    const moreInfo = await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "first_entry:more_info",
      buttonReplyTitle: "المزيد من المعلومات",
    });
    state = await loadRuntime(scope);
    add(assertions, "More Information enters the existing information service", moreInfo.agentSource === "direct" && state.productInfo?.lastTopic === "menu");
    add(assertions, "More Information does not initialize or mutate a cart", !state.orderRuntime && legacyFingerprint(state.orderState) === orderBeforeInfo);
    add(assertions, "More Information preserves deterministic info actions", actionIds(moreInfo).includes("info:price") && actionIds(moreInfo).includes("info:order_now"));
    add(assertions, "More Information does not ask for every order field", !hasAllFieldsPrompt(moreInfo.agentReplyPreview));

    const priceInfo = await receiveWebhook(webhookResults, { scope, text: "شحال الثمن؟" });
    state = await loadRuntime(scope);
    add(assertions, "information price question receives configured deterministic answer", priceInfo.agentSource === "direct" && Boolean(priceInfo.agentReplyPreview?.includes(String(product.price))));
    add(assertions, "price information remains non-mutating", !state.orderRuntime && legacyFingerprint(state.orderState) === orderBeforeInfo);

    const infoOrderNow = await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "info:order_now",
      buttonReplyTitle: "أطلب الآن",
    });
    state = await loadRuntime(scope);
    add(assertions, "info:order_now remains authoritative through webhook mapping", infoOrderNow.normalizedActionId === "info:order_now");
    add(assertions, "info:order_now enters guarded Phase 6.3 planning", infoOrderNow.agentSource === "direct" && state.orderRuntime?.runtimeStage === "PLANNING");
    add(assertions, "info:order_now shares the authoritative Order Now planning entry", state.orderRuntime?.lastHandledAction === "first_entry:order_now");
    add(assertions, "info:order_now never emits obsolete all-fields collection", !hasAllFieldsPrompt(infoOrderNow.agentReplyPreview));

    // Direct Order Now with deliberately stale legacy confirmation present.
    await resetFullScope(scope);
    await receiveWebhook(webhookResults, { scope, text: "سلام" });
    await seedLegacyConfirmed(scope);
    const legacyBeforeRuntime = legacyFingerprint((await loadRuntime(scope)).orderState);
    const directOrder = await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "first_entry:order_now",
      buttonReplyTitle: "أطلب الآن",
    });
    state = await loadRuntime(scope);
    add(assertions, "first_entry:order_now remains authoritative through webhook mapping", directOrder.normalizedActionId === "first_entry:order_now");
    add(assertions, "trusted server-side webhook scope activates guarded runtime", directOrder.agentSource === "direct" && state.orderRuntime?.runtimeStage === "PLANNING");
    add(assertions, "direct Order Now requests the first configured product option", actionIds(directOrder).some((id) => id.startsWith("cart_item_option:size:")));
    add(assertions, "direct Order Now does not enter legacy all-fields collection", !hasAllFieldsPrompt(directOrder.agentReplyPreview));
    add(assertions, "stale legacy confirmation cannot hijack runtime planning", legacyFingerprint(state.orderState) === legacyBeforeRuntime);

    const firstSizeAction = actionIds(directOrder).find((id) => id.startsWith("cart_item_option:size:"));
    let quantitySelector = firstSizeAction
      ? await receiveWebhook(webhookResults, {
          scope,
          buttonReplyId: firstSizeAction,
          buttonReplyTitle: firstSizeAction.split(":").at(-1) || "المقاس",
        })
      : directOrder;
    const offerAction = actionIds(quantitySelector).find((id) => id.startsWith("cart_offer:"));
    if (offerAction) {
      quantitySelector = await receiveWebhook(webhookResults, {
        scope,
        buttonReplyId: offerAction,
        buttonReplyTitle: "العرض",
      });
    }
    add(assertions, "planning exposes stable cart_quantity:2 action", actionIds(quantitySelector).includes("cart_quantity:2"));

    const quantity = await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "cart_quantity:2",
      buttonReplyTitle: "2",
    });
    state = await loadRuntime(scope);
    add(assertions, "cart_quantity:2 input source remains an interactive reply", quantity.inputSourceType === "button_reply");
    add(assertions, "cart_quantity:2 action ID survives webhook normalization", quantity.normalizedActionId === "cart_quantity:2" && state.orderRuntime?.lastHandledAction === "cart_quantity:2");
    add(assertions, "button title 2 does not replace authoritative action ID", quantity.normalizedActionId !== "2");
    add(assertions, "cart_quantity:2 advances PLANNING to COLLECTING_ITEM", quantity.agentSource === "direct" && state.orderRuntime?.runtimeStage === "COLLECTING_ITEM" && state.orderRuntime.cart.targetItemCount === 2);
    add(assertions, "item 1 requests only its first configured option", actionIds(quantity).some((id) => id.startsWith("cart_item_option:")) && !hasAllFieldsPrompt(quantity.agentReplyPreview));
    add(assertions, "runtime action bypasses seller brain and AI", quantity.agentSource === "direct");
    add(assertions, "legacy confirmed values remain isolated during item collection", legacyFingerprint(state.orderState) === legacyBeforeRuntime);

    const runtimeBeforeStale = JSON.stringify(state.orderRuntime);
    const staleLegacyBefore = legacyFingerprint(state.orderState);
    const staleAction = await receiveWebhook(webhookResults, {
      scope,
      buttonReplyId: "cart_quantity:3",
      buttonReplyTitle: "3",
    });
    const afterStale = await loadRuntime(scope);
    add(assertions, "incompatible recognized runtime action returns safe stale recovery", staleAction.agentSource === "direct" && Boolean(staleAction.agentReplyPreview?.includes("ما بقاش صالح")));
    add(assertions, "stale runtime action does not fall through to AI or seller brain", staleAction.agentSource === "direct");
    add(assertions, "stale runtime action does not mutate legacy order state", legacyFingerprint(afterStale.orderState) === staleLegacyBefore);
    add(assertions, "stale runtime action preserves active runtime stage and cart", afterStale.orderRuntime?.runtimeStage === "COLLECTING_ITEM" && JSON.stringify(afterStale.orderRuntime?.cart) === JSON.stringify(JSON.parse(runtimeBeforeStale).cart));

    const reloaded = await loadRuntime(scope);
    add(assertions, "Phase 6.3 runtime state persists through real Valkey abstraction", reloaded.orderRuntime?.runtimeStage === "COLLECTING_ITEM" && reloaded.orderRuntime.cart.targetItemCount === 2);

    const unrelatedPhone = siblingPhone(scope.customerPhone, "6");
    const unrelated = await processCloudWebhookBody(
      buildSimulatedIncomingWebhook({
        from: unrelatedPhone,
        phoneNumberId: scope.phoneNumberId,
        text: "سلام",
      }),
      { forceDryRun: true },
    );
    webhookResults.push(unrelated);
    add(assertions, "unrelated recipient is not activated by guarded webhook bridge", unrelated.handled === false && unrelated.sendAttempted === false);
    add(assertions, "guarded activation remains seller allowlist scoped", readiness.guardedSellerScope === true && (await getOrderRuntimeReadiness("seller_demo_medical", true)).flowEnabled === false);

    const sentMessages = webhookResults.flatMap((result) => result.outboundMessages);
    add(assertions, "all evaluator outbound dispatches are forced dry-run", sentMessages.length > 0 && sentMessages.every((message) => message.dryRun));
    add(assertions, "all dry-run dispatches completed without live provider fallback", sentMessages.every((message) => message.success));
  } finally {
    await resetFullScope(scope);
    await clearConversationSession(
      otherCustomerScope.conversationKey,
      otherCustomerScope.sellerId,
      otherCustomerScope.productId,
    );
    await clearConversationSession(
      otherSellerScope.conversationKey,
      otherSellerScope.sellerId,
      otherSellerScope.productId,
    );
  }

  const finalState = await loadRuntime(scope);
  add(assertions, "final cleanup leaves the dedicated conversation clean", !finalState.orderRuntime && !finalState.firstEntry && !finalState.productInfo && finalState.orderState.confirmed === false);

  const passed = assertions.filter((assertion) => assertion.passed).length;
  const failed = assertions.length - passed;

  return {
    phase: PHASE,
    total: assertions.length,
    passed,
    failed,
    strictAcceptance: failed === 0 && readiness.valkeyReady,
    realValkey: readiness.valkeyReady,
    noLiveSend: true,
    assertions,
    scenario: {
      sellerId: scope.sellerId,
      customerRef: maskRef(scope.customerPhone),
    },
  };
}
