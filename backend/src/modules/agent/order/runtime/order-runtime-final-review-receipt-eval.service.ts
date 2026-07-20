import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { env } from "../../../../config/env";
import { getValkeyClient } from "../../../../infrastructure/valkey/valkey.client";
import {
  buildSimulatedIncomingWebhook,
  processCloudWebhookBody,
  sendDocument,
} from "../../../whatsapp/cloud/whatsapp-cloud.service";
import type { WhatsAppCloudSendResult } from "../../../whatsapp/cloud/whatsapp-cloud.types";
import { productContextService } from "../../config/product-context.service";
import { conversationKeyService } from "../../identity/conversation-key.service";
import { getConversationSession } from "../../session/conversation-session.service";
import { renderFinalOrderReview } from "../delivery-confirmation/final-order-review-renderer.service";
import type { FinalOrderReview } from "../delivery-confirmation/delivery-confirmation.types";
import { getOrderRuntimeReadiness } from "./order-runtime-router.service";
import { resetOrderRuntimeConversation } from "./order-runtime-session.service";
import type { OrderRuntimeSession } from "./order-runtime.types";

type Assertion = { name: string; passed: boolean; detail?: string };
type WebhookResult = Awaited<ReturnType<typeof processCloudWebhookBody>>;
type DocumentInput = Parameters<typeof sendDocument>[0];
type DocumentTransport = (input: DocumentInput) => Promise<WhatsAppCloudSendResult>;

type Scope = {
  sellerId: string;
  customerPhone: string;
  phoneNumberId: string;
  productId: string;
  conversationKey: string;
};

type CapturedDocument = {
  filename: string;
  mimeType: string;
  filePath: string;
  bytes: Buffer;
};

export type OrderRuntimeFinalReviewReceiptEvaluationReport = {
  phase: "6.3H2-R2";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  realValkey: boolean;
  noLiveSend: true;
  assertions: Assertion[];
  blocker?: string;
  scenario: { sellerId?: string; customerRef?: string };
};

const PHASE = "6.3H2-R2" as const;

function add(assertions: Assertion[], name: string, passed: boolean, detail?: string): void {
  assertions.push({ name, passed, ...(passed ? {} : { detail }) });
}

function maskRef(value: string): string {
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function configuredScope(): Scope | undefined {
  const sellerId = env.firstEntryLiveSmokeSellerId.trim();
  const customerPhone = env.firstEntryLiveSmokeTestRecipient.replace(/\D/g, "");
  const phoneNumberId = env.whatsappCloudPhoneNumberId.trim();
  if (!sellerId || !customerPhone || !phoneNumberId) return undefined;
  const productId = productContextService.getActiveProductContext(sellerId).productId;
  return {
    sellerId,
    customerPhone,
    phoneNumberId,
    productId,
    conversationKey: conversationKeyService.buildConversationKey(sellerId, customerPhone),
  };
}

async function reset(scope: Scope): Promise<void> {
  await resetOrderRuntimeConversation(scope);
}

async function loadRuntime(scope: Scope): Promise<OrderRuntimeSession | undefined> {
  const session = await getConversationSession(
    scope.conversationKey,
    scope.sellerId,
    scope.productId,
    scope.customerPhone,
  );
  return session.orderRuntime as OrderRuntimeSession | undefined;
}

async function receive(input: {
  scope: Scope;
  text?: string;
  actionId?: string;
  actionTitle?: string;
  documentTransport?: DocumentTransport;
}): Promise<WebhookResult> {
  return processCloudWebhookBody(
    buildSimulatedIncomingWebhook({
      from: input.scope.customerPhone,
      phoneNumberId: input.scope.phoneNumberId,
      text: input.text,
      buttonReplyId: input.actionId,
      buttonReplyTitle: input.actionTitle,
    }),
    {
      forceDryRun: true,
      ...(input.documentTransport
        ? { runtimeDocumentTransport: input.documentTransport }
        : {}),
    },
  );
}

function actionIds(result: WebhookResult): string[] {
  return result.outboundMessages.flatMap((message) => message.actionIds);
}

async function action(
  scope: Scope,
  actionId: string,
  documentTransport?: DocumentTransport,
): Promise<WebhookResult> {
  return receive({
    scope,
    actionId,
    actionTitle: actionId,
    ...(documentTransport ? { documentTransport } : {}),
  });
}

async function startStandardCart(scope: Scope, units: 1 | 2): Promise<WebhookResult> {
  await receive({ scope, text: "سلام" });
  await action(scope, "first_entry:order_now");
  let result = await action(scope, `cart_quantity:${units}`);
  await action(scope, "cart_item_option:size:38");
  await action(scope, "cart_item_option:color:أسود");
  result = await receive({ scope, text: "1" });
  if (units === 2) {
    await action(scope, "cart_item_option:size:40");
    await action(scope, "cart_item_option:color:وردي");
    result = await receive({ scope, text: "1" });
  }
  return result;
}

async function collectDelivery(scope: Scope): Promise<WebhookResult> {
  await action(scope, "cart_review:continue");
  await receive({ scope, text: "عمر العزري" });
  await receive({ scope, text: "0612345678" });
  await receive({ scope, text: "مراكش" });
  return receive({ scope, text: "حي السلام زنقة 4 رقم 12" });
}

function hasPdfSignature(buffer: Buffer | undefined): boolean {
  return Boolean(buffer && buffer.length > 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-");
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function buildOfferReviewFixture(): FinalOrderReview {
  return {
    items: [
      {
        id: "internal-item-never-render",
        productId: "internal-product-never-render",
        productName: "منتج تجريبي",
        quantity: 3,
        options: [{ key: "variant", label: "الاختيار", value: "أزرق" }],
        unitPriceMinor: 19900,
        lineTotalMinor: 59700,
        unitPrice: 199,
        lineTotal: 597,
      },
    ],
    completedUnits: 3,
    targetUnits: 3,
    orderFields: [{ key: "city", label: "المدينة", value: "الرباط" }],
    standardSubtotalMinor: 59700,
    standardSubtotal: 597,
    currency: "MAD",
    selectedOffer: {
      offerId: "internal-offer-never-render",
      label: "عرض ثلاث قطع",
      totalMinor: 49900,
      total: 499,
      discountMinor: 9800,
      discountAmount: 98,
    },
    merchandiseTotalMinor: 49900,
    merchandiseTotal: 499,
    deliveryFee: { type: "PAID", amountMinor: 2500, amount: 25, currency: "MAD" },
    finalTotalMinor: 52400,
    finalTotal: 524,
    warnings: [],
    confirmationReady: true,
  };
}

/** Permanent real-Valkey, real-webhook, forced-dry-run H2-R2 evaluator. */
export async function evaluateOrderRuntimeFinalReviewReceipt(): Promise<OrderRuntimeFinalReviewReceiptEvaluationReport> {
  const assertions: Assertion[] = [];
  const scope = configuredScope();
  if (!scope) {
    add(assertions, "configured guarded scope is available", false, "Missing guarded seller, recipient, or phone number ID.");
    return {
      phase: PHASE,
      total: assertions.length,
      passed: 0,
      failed: assertions.length,
      strictAcceptance: false,
      realValkey: false,
      noLiveSend: true,
      blocker: "Configured guarded scope is unavailable.",
      assertions,
      scenario: {},
    };
  }

  let realValkey = false;
  try {
    realValkey = (await getValkeyClient().ping()) === "PONG";
  } catch (_error) {
    realValkey = false;
  }
  const readiness = await getOrderRuntimeReadiness(scope.sellerId, true);
  if (!realValkey || !readiness.flowEnabled) {
    add(assertions, "real Valkey-backed guarded runtime is ready", false, readiness.reason || "Valkey unavailable");
    return {
      phase: PHASE,
      total: assertions.length,
      passed: 0,
      failed: assertions.length,
      strictAcceptance: false,
      realValkey,
      noLiveSend: true,
      blocker: readiness.reason || "Guarded runtime is unavailable.",
      assertions,
      scenario: { sellerId: scope.sellerId, customerRef: maskRef(scope.customerPhone) },
    };
  }

  const captured: CapturedDocument[] = [];
  const successfulTransport: DocumentTransport = async (input) => {
    const bytes = await readFile(input.filePath);
    captured.push({
      filename: input.filename,
      mimeType: "application/pdf",
      filePath: input.filePath,
      bytes,
    });
    return {
      success: true,
      dryRun: true,
      payload: { type: "document", filename: input.filename, mimeType: "application/pdf" },
      response: { dryRun: true, messages: [{ id: "dryrun-h2-r2-document-message" }] },
      mediaId: "dryrun-h2-r2-media",
    };
  };
  const failedTransport: DocumentTransport = async (input) => ({
    success: false,
    dryRun: true,
    payload: { type: "document", filename: input.filename, mimeType: "application/pdf" },
    errorMessage: "Injected H2-R2 document failure",
    graphCode: "EVAL_DOCUMENT_FAILURE",
  });

  await reset(scope);
  try {
    const cartReady = await startStandardCart(scope, 2);
    let runtime = await loadRuntime(scope);
    add(assertions, "multi-item collection reaches cart review", runtime?.runtimeStage === "CART_REVIEW" && runtime.cart.items.length === 2);
    add(assertions, "cart review remains interactive", actionIds(cartReady).includes("cart_review:continue") && actionIds(cartReady).includes("cart_review:edit"));

    const initialFinal = await collectDelivery(scope);
    runtime = await loadRuntime(scope);
    const initialReview = initialFinal.outboundMessages[0];
    const initialCta = initialFinal.outboundMessages[1];
    const initialText = initialReview?.text || "";
    add(assertions, "last delivery field advances to FINAL_ORDER_REVIEW", runtime?.runtimeStage === "FINAL_ORDER_REVIEW");
    add(assertions, "full review and CTA are two ordered messages", initialFinal.outboundMessages.length === 2 && initialReview?.kind === "text" && initialCta?.kind === "interactive");
    add(assertions, "review text is dispatched before CTA", initialFinal.outboundMessages.indexOf(initialReview) < initialFinal.outboundMessages.indexOf(initialCta));
    add(assertions, "review includes every cart item", (initialText.match(/صندالة نسائية/g) || []).length === 2);
    add(assertions, "review includes first selected size", initialText.includes("المقاس: 38"));
    add(assertions, "review includes second selected size", initialText.includes("المقاس: 40"));
    add(assertions, "review includes every selected color", initialText.includes("اللون: أسود") && initialText.includes("اللون: وردي"));
    add(assertions, "review includes item quantities", (initialText.match(/الكمية: 1/g) || []).length === 2);
    add(assertions, "review includes authoritative unit prices", (initialText.match(/ثمن الوحدة: 199 درهم/g) || []).length === 2);
    add(assertions, "review includes authoritative line totals", (initialText.match(/المجموع: 199 درهم/g) || []).length === 2);
    add(assertions, "review includes standard subtotal", initialText.includes("المجموع قبل العرض: 398 درهم"));
    add(assertions, "review includes configured paid delivery", initialText.includes("التوصيل: 30 درهم"));
    add(assertions, "review includes final total with delivery", initialText.includes("المجموع النهائي: 428 درهم"));
    add(assertions, "review includes full name", initialText.includes("الاسم الكامل: عمر العزري"));
    add(assertions, "review includes phone", initialText.includes("رقم الهاتف: 0612345678"));
    add(assertions, "review includes city", initialText.includes("المدينة: مراكش"));
    add(assertions, "review includes address", initialText.includes("العنوان: حي السلام زنقة 4 رقم 12"));
    add(assertions, "generic sentence does not replace the full review", initialText.trim() !== "راجع معلومات الطلب ومن بعد أكد الطلب" && initialText.length > 200);
    const privateValues = [scope.sellerId, scope.conversationKey, ...runtime!.cart.items.map((item) => item.id)];
    add(assertions, "review excludes seller conversation and item IDs", privateValues.every((value) => !initialText.includes(value)));
    add(assertions, "CTA includes stable confirm action", initialCta?.actionIds.includes("order_checkout:confirm") === true);
    add(assertions, "CTA includes existing cart edit action", initialCta?.actionIds.includes("order_checkout:back_to_cart") === true);
    add(assertions, "CTA includes existing delivery edit action", initialCta?.actionIds.includes("order_checkout:edit_delivery") === true);
    add(assertions, "final review dispatch is deterministic and AI-free", initialFinal.agentSource === "direct" && initialFinal.outboundMessages.every((message) => message.dryRun));

    const firstItemId = runtime?.cart.items[0]?.id || "";
    const editCart = await action(scope, "order_checkout:back_to_cart");
    runtime = await loadRuntime(scope);
    add(assertions, "cart edit action does not confirm", runtime?.runtimeStage === "CART_REVIEW" && !runtime.confirmed);
    add(assertions, "cart edit reuses existing cart review presentation", actionIds(editCart).includes("cart_review:edit") && actionIds(editCart).includes("cart_review:continue"));
    await action(scope, "cart_review:edit");
    await action(scope, `cart_review_item:select:${firstItemId}`);
    await action(scope, `cart_review_item:options:${firstItemId}`);
    await action(scope, "cart_item_option:size:39");
    await action(scope, "cart_review_item_edit:save");
    runtime = await loadRuntime(scope);
    add(assertions, "item edit updates authoritative cart", runtime?.cart.items[0]?.selectedOptions.size === "39");
    add(assertions, "cart edit preserves delivery fields", runtime?.cart.orderLevelFields.city === "مراكش" && runtime.cart.orderLevelFields.address === "حي السلام زنقة 4 رقم 12");
    const afterCartEdit = await action(scope, "cart_review:continue");
    runtime = await loadRuntime(scope);
    add(assertions, "cart edit returns directly to FINAL_ORDER_REVIEW", runtime?.runtimeStage === "FINAL_ORDER_REVIEW");
    add(assertions, "updated cart review is rendered in full again", afterCartEdit.outboundMessages.length === 2 && afterCartEdit.outboundMessages[0]?.text.includes("المقاس: 39") === true);
    add(assertions, "pricing is refreshed after cart edit", afterCartEdit.outboundMessages[0]?.text.includes("المجموع النهائي: 428 درهم") === true);

    const deliverySelector = await action(scope, "order_checkout:edit_delivery");
    runtime = await loadRuntime(scope);
    add(assertions, "delivery edit does not confirm", runtime?.runtimeStage === "FINAL_ORDER_REVIEW" && runtime.deliveryConfirmationState?.kind === "EDITING_DELIVERY_FIELD" && !runtime.confirmed);
    add(assertions, "delivery edit reuses configured field selector", actionIds(deliverySelector).includes("order_checkout_field:select:city") && actionIds(deliverySelector).includes("order_checkout_field:select:address"));
    await action(scope, "order_checkout_field:select:city");
    const cityEdited = await receive({ scope, text: "الرباط" });
    runtime = await loadRuntime(scope);
    add(assertions, "delivery edit updates only selected city", runtime?.cart.orderLevelFields.city === "الرباط" && runtime.cart.orderLevelFields.address === "حي السلام زنقة 4 رقم 12");
    add(assertions, "city edit returns updated full review", runtime?.runtimeStage === "FINAL_ORDER_REVIEW" && cityEdited.outboundMessages.length === 2 && cityEdited.outboundMessages[0]?.text.includes("المدينة: الرباط") === true);
    add(assertions, "delivery amount is repriced after city edit", cityEdited.outboundMessages[0]?.text.includes("التوصيل: 25 درهم") === true);
    add(assertions, "final total is repriced after city edit", cityEdited.outboundMessages[0]?.text.includes("المجموع النهائي: 423 درهم") === true);
    await action(scope, "order_checkout:edit_delivery");
    await action(scope, "order_checkout_field:select:address");
    const addressEdited = await receive({ scope, text: "حي النصر رقم 8" });
    runtime = await loadRuntime(scope);
    add(assertions, "customer can edit more than once", runtime?.runtimeStage === "FINAL_ORDER_REVIEW" && addressEdited.outboundMessages[0]?.text.includes("العنوان: حي النصر رقم 8") === true);
    add(assertions, "second delivery edit preserves first edit", runtime?.cart.orderLevelFields.city === "الرباط");
    add(assertions, "only explicit confirmation can reach CONFIRMED", !runtime?.confirmed && runtime?.runtimeStage === "FINAL_ORDER_REVIEW");

    const beforeConfirmJson = JSON.stringify(runtime);
    const confirm = await action(scope, "order_checkout:confirm", successfulTransport);
    runtime = await loadRuntime(scope);
    const confirmationText = confirm.outboundMessages[0];
    const receiptMessage = confirm.outboundMessages[1];
    const receipt = captured[0];
    add(assertions, "explicit confirmation reaches CONFIRMED", runtime?.runtimeStage === "CONFIRMED" && runtime.confirmed?.status === "CONFIRMED");
    add(assertions, "one immutable snapshot identity is persisted", Boolean(runtime?.confirmed?.snapshotId && runtime.confirmed.snapshotId === runtime.confirmed.publicOrderCode));
    add(assertions, "public order code does not expose conversation key", Boolean(runtime?.confirmed?.publicOrderCode.startsWith("CMD-") && !runtime.confirmed.publicOrderCode.includes(scope.conversationKey)));
    add(assertions, "confirmation text dispatch occurs first", confirmationText?.kind === "text" && confirmationText.text.includes("تم تأكيد الطلب") && confirmationText.text.includes(runtime?.confirmed?.publicOrderCode || "__missing__"));
    add(assertions, "document dispatch occurs second", receiptMessage?.kind === "document" && confirm.outboundMessages.indexOf(confirmationText) < confirm.outboundMessages.indexOf(receiptMessage));
    add(assertions, "real receipt PDF has valid signature", hasPdfSignature(receipt?.bytes));
    add(assertions, "real receipt PDF byte length is non-zero", Boolean(receipt && receipt.bytes.length > 1000));
    add(assertions, "document MIME is application/pdf", receipt?.mimeType === "application/pdf" && receiptMessage?.mimeType === "application/pdf");
    add(assertions, "receipt filename is safe and deterministic for snapshot", Boolean(receipt?.filename === `order-${runtime?.confirmed?.publicOrderCode}.pdf` && /^[A-Za-z0-9._-]+\.pdf$/.test(receipt.filename)));
    add(assertions, "receipt metadata checksum and byte length are persisted", runtime?.confirmed?.receipt.byteLength === receipt?.bytes.length && Boolean(runtime?.confirmed?.receipt.checksum));
    add(assertions, "successful dispatch stores SENT metadata", runtime?.confirmed?.receipt.dispatchStatus === "SENT" && Boolean(runtime.confirmed.receipt.sentAt));
    const runtimeJson = JSON.stringify(runtime);
    add(assertions, "PDF Buffer is not stored in Valkey", !/\"buffer\"\s*:|Buffer|Uint8Array/i.test(runtimeJson));
    add(assertions, "PDF base64 is not stored in Valkey", !/base64,|JVBERi0/i.test(runtimeJson));
    add(assertions, "webhook JSON exposes receipt metadata but no bytes", Boolean(receiptMessage?.checksum && !JSON.stringify(confirm).includes("JVBERi0")));
    add(assertions, "temporary receipt file is deleted after dispatch", !(await fileExists(receipt?.filePath)));
    add(assertions, "confirmation preserves final edited cart", beforeConfirmJson.includes("حي النصر رقم 8") && runtimeJson.includes("حي النصر رقم 8"));

    const confirmedSnapshotId = runtime?.confirmed?.snapshotId;
    const duplicate = await action(scope, "order_checkout:confirm", successfulTransport);
    const afterDuplicate = await loadRuntime(scope);
    add(assertions, "duplicate confirm keeps the same snapshot", afterDuplicate?.confirmed?.snapshotId === confirmedSnapshotId);
    add(assertions, "duplicate confirm does not generate another PDF", captured.length === 1);
    add(assertions, "duplicate confirm does not dispatch another document", duplicate.outboundMessages.every((message) => message.kind !== "document"));
    add(assertions, "duplicate confirm returns safe already-confirmed response", duplicate.outboundMessages[0]?.text.includes("تأكد من قبل") === true);

    const offerRendered = renderFinalOrderReview(buildOfferReviewFixture()).text;
    add(assertions, "offer review includes configured label", offerRendered.includes("العرض: عرض ثلاث قطع"));
    add(assertions, "offer review includes authoritative discount", offerRendered.includes("التخفيض: 98 درهم"));
    add(assertions, "offer review includes delivery and offer-adjusted final", offerRendered.includes("التوصيل: 25 درهم") && offerRendered.includes("المجموع النهائي: 524 درهم"));
    add(assertions, "offer review excludes implementation IDs", !offerRendered.includes("internal-offer-never-render") && !offerRendered.includes("internal-item-never-render"));

    await reset(scope);
    await startStandardCart(scope, 1);
    await collectDelivery(scope);
    const failedConfirm = await action(scope, "order_checkout:confirm", failedTransport);
    const failedRuntime = await loadRuntime(scope);
    add(assertions, "document failure leaves order CONFIRMED", failedRuntime?.runtimeStage === "CONFIRMED" && failedRuntime.confirmed?.status === "CONFIRMED");
    add(assertions, "document failure is recorded safely", failedRuntime?.confirmed?.receipt.dispatchStatus === "FAILED" && failedRuntime.confirmed.receipt.failureCode === "CLOUD_EVAL_DOCUMENT_FAILURE");
    add(assertions, "failed document is not falsely marked SENT", !failedRuntime?.confirmed?.receipt.sentAt && failedRuntime?.confirmed?.receipt.dispatchStatus !== "SENT");
    add(assertions, "failure still dispatches confirmation text before document attempt", failedConfirm.outboundMessages[0]?.kind === "text" && failedConfirm.outboundMessages[1]?.kind === "document");
    add(assertions, "failure response reports document failure", failedConfirm.outboundMessages[1]?.success === false && failedConfirm.sendSuccess === false);
    add(assertions, "failed dispatch stores no PDF bytes", !/\"buffer\"\s*:|JVBERi0|base64,/i.test(JSON.stringify(failedRuntime)));
    add(assertions, "all evaluator provider-facing messages are dry-run", [...confirm.outboundMessages, ...failedConfirm.outboundMessages].every((message) => message.dryRun));

    add(assertions, "runtime source did not mutate legacy order model", !runtimeJson.includes("orderState"));
    add(assertions, "focused evaluator contains at least forty assertions", assertions.length >= 40);
  } finally {
    await reset(scope);
  }

  const clean = await loadRuntime(scope);
  add(assertions, "final cleanup removes only the evaluator conversation runtime", !clean);
  const passed = assertions.filter((assertion) => assertion.passed).length;
  const failed = assertions.length - passed;
  return {
    phase: PHASE,
    total: assertions.length,
    passed,
    failed,
    strictAcceptance: failed === 0 && assertions.length >= 40 && realValkey,
    realValkey,
    noLiveSend: true,
    assertions,
    scenario: { sellerId: scope.sellerId, customerRef: maskRef(scope.customerPhone) },
  };
}
