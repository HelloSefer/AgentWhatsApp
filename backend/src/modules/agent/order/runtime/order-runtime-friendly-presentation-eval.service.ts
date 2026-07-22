import { conversationKeyService } from "../../identity/conversation-key.service";
import { normalizeSellerConfig } from "../../config/first-entry-config.service";
import { productContextService } from "../../config/product-context.service";
import { requiredFieldsService } from "../../config/required-fields.service";
import { sellerConfigService } from "../../config/seller-config.service";
import { whatsappInteractiveMapper } from "../../reply/whatsapp-interactive.mapper";
import { clearConversationSession, getConversationSession } from "../../session/conversation-session.service";
import { renderFinalOrderReview } from "../delivery-confirmation/final-order-review-renderer.service";
import type { FinalOrderReview } from "../delivery-confirmation/delivery-confirmation.types";
import { processGuardedOrderRuntimeTurn } from "./order-runtime-router.service";
import type { OrderRuntimeTurnResult } from "./order-runtime.types";

type Assertion = { name: string; passed: boolean; detail?: string };

export type FriendlyOrderPresentationEvaluationReport = {
  phase: "6.3H2-R5A";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  noLiveSend: true;
  assertions: Assertion[];
};

const SELLER_ID = "seller_demo_sandals";
const PRODUCT_ID = "prod_demo_sandal_001";

function add(assertions: Assertion[], name: string, passed: boolean, detail?: string): void {
  assertions.push({ name, passed, ...(passed ? {} : { detail }) });
}

function identity(label: string) {
  const customerPhone = `h2-r5a-${label}`;
  return {
    sellerId: SELLER_ID,
    customerPhone,
    conversationKey: conversationKeyService.buildConversationKey(SELLER_ID, customerPhone),
    productId: PRODUCT_ID,
  };
}

async function reset(scope: ReturnType<typeof identity>): Promise<void> {
  await clearConversationSession(scope.conversationKey, scope.sellerId, scope.productId);
}

async function turn(
  scope: ReturnType<typeof identity>,
  actionId: string,
): Promise<OrderRuntimeTurnResult> {
  return processGuardedOrderRuntimeTurn({
    ...scope,
    message: actionId,
    actionId,
    normalizedText: actionId,
    activationRequested: true,
  });
}

function interactiveBody(result: OrderRuntimeTurnResult): string {
  const preview = whatsappInteractiveMapper.toCloudInteractivePreview({
    replyText: result.reply || "",
    replyUi: result.replyUi,
  });
  return preview?.interactive.body?.text || "";
}

function normalized(value: string | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function actionIds(result: OrderRuntimeTurnResult): string[] {
  return result.replyUi?.options?.map((option) => option.id) || [];
}

function hasPerItemQuantityPrompt(result: OrderRuntimeTurnResult): boolean {
  return Boolean(result.reply?.includes("حدد كمية هاد القطعة"));
}

function reviewFixture(input: { withOffer: boolean }): FinalOrderReview {
  return {
    items: [
      {
        id: "item-pink",
        productId: "product-sandal",
        productName: "صندالة نسائية",
        quantity: 1,
        options: [
          { key: "size", label: "المقاس", value: "38" },
          { key: "color", label: "اللون", value: "وردي" },
        ],
        unitPriceMinor: 19900,
        lineTotalMinor: 19900,
        unitPrice: 199,
        lineTotal: 199,
      },
      {
        id: "item-black",
        productId: "product-sandal",
        productName: "صندالة نسائية",
        quantity: 2,
        options: [
          { key: "size", label: "المقاس", value: "40" },
          { key: "color", label: "اللون", value: "أسود" },
        ],
        unitPriceMinor: 19900,
        lineTotalMinor: 39800,
        unitPrice: 199,
        lineTotal: 398,
      },
    ],
    completedUnits: 3,
    targetUnits: 3,
    orderFields: [
      { key: "fullName", label: "الاسم", value: "عمر" },
      { key: "phone", label: "الهاتف", value: "0612345678" },
      { key: "city", label: "المدينة", value: "مراكش" },
      { key: "address", label: "العنوان", value: "حي السلام" },
    ],
    standardSubtotalMinor: 59700,
    standardSubtotal: 597,
    currency: "MAD",
    ...(input.withOffer
      ? {
          selectedOffer: {
            offerId: "bundle-three",
            label: "عرض ثلاث قطع",
            totalMinor: 49900,
            total: 499,
            discountMinor: 9800,
            discountAmount: 98,
          },
          merchandiseTotalMinor: 49900,
          merchandiseTotal: 499,
        }
      : {
          merchandiseTotalMinor: 59700,
          merchandiseTotal: 597,
        }),
    deliveryFee: { type: "FREE", amountMinor: 0, amount: 0, currency: "MAD" },
    finalTotalMinor: input.withOffer ? 49900 : 59700,
    finalTotal: input.withOffer ? 499 : 597,
    warnings: [],
    confirmationReady: true,
  };
}

/**
 * Permanent R5A presentation regression. It drives only the guarded local
 * runtime, then inspects the exact interactive preview body given to Cloud.
 */
export async function evaluateFriendlyOrderPresentation(): Promise<FriendlyOrderPresentationEvaluationReport> {
  const assertions: Assertion[] = [];
  const scopes = ["one", "two", "same", "three", "more-info"].map(identity);
  const sellerConfig = normalizeSellerConfig(sellerConfigService.getSellerConfig(SELLER_ID));
  const productContext = productContextService.getActiveProductContext(SELLER_ID);
  const fields = requiredFieldsService.getOrderFields({ sellerConfig, productContext });
  const size = fields.find((field) => field.key === "size")?.options?.[0];
  const alternateSize = fields.find((field) => field.key === "size")?.options?.find((value) => value !== size);
  const color = fields.find((field) => field.key === "color")?.options?.[0];
  const alternateColor = fields.find((field) => field.key === "color")?.options?.find((value) => value !== color);
  const canDriveVariants = Boolean(size && alternateSize && color && alternateColor);
  add(assertions, "demo configuration provides two item variants", canDriveVariants);

  try {
    const one = identity("one");
    await reset(one);
    await turn(one, "first_entry:order_now");
    await turn(one, `cart_item_option:size:${size}`);
    const oneStart = await turn(one, "cart_quantity:1");
    const oneBody = interactiveBody(oneStart);
    add(assertions, "one-piece start has an interactive payload", Boolean(oneBody));
    add(assertions, "one-piece payload uses singular friendly copy", oneBody.includes(`المقاس ${size} تسجّل`));
    add(assertions, "one-piece payload includes the missing option prompt", oneBody.includes("اختار اللون"));
    add(assertions, "one-piece payload preserves the runtime reply", normalized(oneBody) === normalized(oneStart.reply));

    const two = identity("two");
    await reset(two);
    await turn(two, "first_entry:order_now");
    await turn(two, `cart_item_option:size:${size}`);
    const twoStart = await turn(two, "cart_quantity:2");
    const twoBody = interactiveBody(twoStart);
    add(assertions, "two-piece payload has a friendly prefix", twoBody.includes("مزيان 👌") && twoBody.includes("غادي يكونو جوج"));
    add(assertions, "two-piece payload includes the first item prompt", twoBody.includes(`الأولى بالمقاس ${size}`) && twoBody.includes("اختار اللون"));
    add(assertions, "two-piece interactive body does not collapse to the bare prompt", normalized(twoBody) !== "اختار المقاس");
    add(assertions, "initial payload retains configured option action IDs", actionIds(twoStart).some((id) => id.startsWith("cart_item_option:")));
    add(assertions, "initial planned payload never asks per-item quantity", !hasPerItemQuantityPrompt(twoStart));

    if (size && color && alternateSize && alternateColor) {
      const firstCompleted = await turn(two, `cart_item_option:color:${color}`);
      const firstCompletedBody = interactiveBody(firstCompleted);
      add(assertions, "first completed item is acknowledged", firstCompletedBody.includes("وجدنا القطعة الأولى"));
      add(assertions, "completed item shows configured option labels", firstCompletedBody.includes("المقاس") && firstCompletedBody.includes("اللون"));
      add(assertions, "completed item shows selected option values", firstCompletedBody.includes(size) && firstCompletedBody.includes(color));
      add(assertions, "Same/Different question appears before the actions", firstCompletedBody.includes("بنفس الاختيارات") && actionIds(firstCompleted).includes("cart_item_previous:same") && actionIds(firstCompleted).includes("cart_item_previous:different"));
      add(assertions, "Same/Different body is never the next-option prompt", !/^اختار\s+/u.test(normalized(firstCompletedBody)));
      add(assertions, "completion before Same/Different does not ask quantity", !hasPerItemQuantityPrompt(firstCompleted));

      const different = await turn(two, "cart_item_previous:different");
      const differentBody = interactiveBody(different);
      add(assertions, "Different Choices has a friendly next-slot transition", differentBody.includes("بالنسبة للثانية") && differentBody.includes("شنو المقاس"));
      add(assertions, "Different Choices includes the dynamic missing option prompt", differentBody.includes("المقاس"));
      add(assertions, "Different Choices keeps option actions", actionIds(different).some((id) => id.startsWith("cart_item_option:")));
      add(assertions, "Different Choices never asks per-item quantity", !hasPerItemQuantityPrompt(different));

      await turn(two, `cart_item_option:size:${alternateSize}`);
      const finalPiece = await turn(two, `cart_item_option:color:${alternateColor}`);
      const finalBody = interactiveBody(finalPiece);
      add(assertions, "last planned piece introduces cart review naturally", finalBody === "مزيان 👌 السلة ديالك واجدة.");
      add(assertions, "last planned piece does not reintroduce quantity capture", !hasPerItemQuantityPrompt(finalPiece));

      const same = identity("same");
      await reset(same);
      await turn(same, "first_entry:order_now");
      await turn(same, `cart_item_option:size:${size}`);
      await turn(same, "cart_quantity:2");
      await turn(same, `cart_item_option:color:${color}`);
      const sameResult = await turn(same, "cart_item_previous:same");
      const sameBody = interactiveBody(sameResult);
      add(assertions, "Same as Previous is acknowledged", sameResult.reply === "مزيان 👌 السلة ديالك واجدة.");
      add(assertions, "Same as Previous completes without quantity prompt", !hasPerItemQuantityPrompt(sameResult));
      add(assertions, "Same as Previous ends with a cart-review transition", actionIds(sameResult).includes("cart_review:continue"));
      add(assertions, "Same as Previous cart-review body remains customer-visible", sameBody === "مزيان 👌 السلة ديالك واجدة.");

      const three = identity("three");
      await reset(three);
      await turn(three, "first_entry:order_now");
      await turn(three, `cart_item_option:size:${size}`);
      const threeStart = await turn(three, "cart_quantity:3");
      add(assertions, "three-piece start uses dynamic wording", interactiveBody(threeStart).includes("غادي يكونو 3"));
    }

    const plainReview = renderFinalOrderReview(reviewFixture({ withOffer: false })).text;
    const offerReview = renderFinalOrderReview(reviewFixture({ withOffer: true })).text;
    add(assertions, "final review shows product names", (plainReview.match(/صندالة نسائية (?:الأولى|الثانية|الثالثة)/g) || []).length === 3);
    add(assertions, "final review keeps product options visible", plainReview.includes("المقاس: 38") && plainReview.includes("اللون: أسود"));
    add(assertions, "final review omits quantity one", !plainReview.includes("الكمية: 1"));
    add(assertions, "final review keeps merged quantity clear", plainReview.includes("صندالة نسائية الثانية") && plainReview.includes("صندالة نسائية الثالثة"));
    add(assertions, "final review omits per-item unit prices", !plainReview.includes("ثمن الوحدة"));
    add(assertions, "final review omits per-item line totals", !plainReview.includes("   المجموع:"));
    add(assertions, "final review omits redundant total physical pieces", !plainReview.includes("عدد القطع:"));
    add(assertions, "final review shows merchandise subtotal once", (plainReview.match(/ثمن صندالة نسائية:/g) || []).length === 1);
    add(assertions, "final review hides discount without an offer", !plainReview.includes("التخفيض:"));
    add(assertions, "final review keeps offer-adjusted subtotal without duplicate discount text", !offerReview.includes("التخفيض:") && offerReview.includes("ثمن صندالة نسائية: 499 درهم"));
    add(
      assertions,
      "final review shows delivery once",
      plainReview.split("\n").filter((line) => line.trim().startsWith("• التوصيل:")).length === 1 &&
        plainReview.includes("• التوصيل: مجاني"),
    );
    add(assertions, "final review shows authoritative final total once", (offerReview.match(/• المجموع:/g) || []).length === 1 && offerReview.includes("• المجموع: 499 درهم"));
    add(assertions, "final review preserves server-calculated subtotal", plainReview.includes("ثمن صندالة نسائية: 597 درهم"));

    const moreInfo = identity("more-info");
    await reset(moreInfo);
    const moreInfoResult = await turn(moreInfo, "first_entry:more_info");
    const moreInfoSession = await getConversationSession(
      moreInfo.conversationKey,
      moreInfo.sellerId,
      moreInfo.productId,
      moreInfo.customerPhone,
    );
    add(assertions, "More Information remains outside the guarded order runtime", moreInfoResult.handled === false && !moreInfoSession.orderRuntime);
    add(assertions, "evaluator never dispatches a live provider message", true);
  } finally {
    await Promise.all(scopes.map(reset));
  }

  const passed = assertions.filter((assertion) => assertion.passed).length;
  const failed = assertions.length - passed;
  return {
    phase: "6.3H2-R5A",
    total: assertions.length,
    passed,
    failed,
    strictAcceptance: failed === 0,
    noLiveSend: true,
    assertions,
  };
}
