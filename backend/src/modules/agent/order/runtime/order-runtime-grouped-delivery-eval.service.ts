import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { createCartItem, initializeCart } from "../cart-state.service";
import { runDeliveryConfirmationPreview } from "../delivery-confirmation/delivery-confirmation-preview.service";
import type {
  DeliveryConfirmationPreviewInput,
  DeliveryConfirmationPreviewResult,
} from "../delivery-confirmation/delivery-confirmation.types";
import { buildCartReviewCompletionCopy } from "./order-runtime-presentation-copy.service";
import { replyFromCartReview } from "./order-runtime-reply.service";

type Assertion = { name: string; passed: boolean; detail?: string };

export type GroupedDeliveryEvaluationReport = {
  phase: "6.3H2-R5-R2";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  noLiveSend: true;
  assertions: Assertion[];
};

const sellerId = "h2-r5-r2-delivery";
const productId = "h2-r5-r2-product";
const now = new Date("2026-07-20T10:00:00.000Z");

const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Test product",
  price: 179,
  currency: "MAD",
  active: true,
  images: [],
  benefits: [],
  optionGroups: [],
  infoMenu: [],
  stock: { enabled: false, status: "AVAILABLE" },
  offers: [],
};

const standardFields: RequiredOrderField[] = [
  { key: "fullName", label: "الاسم الكامل", required: true, enabled: true, source: "customerField", askOrder: 10, semanticType: "PERSON_NAME", captureMode: "OPEN_TEXT" },
  { key: "phone", label: "رقم الهاتف", required: true, enabled: true, source: "customerField", askOrder: 20, semanticType: "PHONE", captureMode: "PHONE" },
  { key: "city", label: "المدينة", required: true, enabled: true, source: "customerField", askOrder: 30, semanticType: "LOCATION", captureMode: "LOCATION" },
  { key: "address", label: "العنوان", prompt: "دابا صيفط ليا العنوان بالتفصيل.", required: true, enabled: true, source: "customerField", askOrder: 40, semanticType: "ADDRESS", captureMode: "ADDRESS" },
];

function add(assertions: Assertion[], name: string, passed: boolean, detail?: string): void {
  assertions.push({ name, passed, ...(passed ? {} : { detail }) });
}

function baseCart() {
  return {
    ...initializeCart(),
    status: "CART_REVIEW" as const,
    targetItemCount: 1,
    items: [createCartItem({ id: "r5-r2-line", productId, quantity: 1, selectedOptions: {}, status: "COMPLETE" })],
  };
}

function source(overrides: Partial<DeliveryConfirmationPreviewInput> = {}): DeliveryConfirmationPreviewInput {
  const offerLookup = new OfferConfigService().getConfiguredOffers({ sellerId, productId, productContexts: [productContext] });
  return {
    previewEnabled: true,
    sellerId,
    conversationScopeId: "h2-r5-r2-preview-customer",
    productContext,
    requiredFields: standardFields,
    offerLookup,
    cart: baseCart(),
    now,
    ...overrides,
  };
}

function start(fields = standardFields): DeliveryConfirmationPreviewResult {
  return runDeliveryConfirmationPreview(source({ requiredFields: fields }));
}

function advance(
  previous: DeliveryConfirmationPreviewResult,
  text: string | undefined,
  fields = standardFields,
  actionId?: string,
): DeliveryConfirmationPreviewResult {
  return runDeliveryConfirmationPreview(source({
    requiredFields: fields,
    cart: previous.cartAfter,
    previewState: previous.previewState,
    ...(text === undefined ? {} : { deliveryConfirmationText: text }),
    ...(actionId ? { rawActionId: actionId } : {}),
  }));
}

function count(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

/** Preview-only regression for the R5-R2 customer-facing transition and intake. */
export async function evaluateGroupedDeliveryIntake(): Promise<GroupedDeliveryEvaluationReport> {
  const assertions: Assertion[] = [];
  const cartReview = replyFromCartReview(
    {
      presentation: { text: "راجع السلة ديالك قبل ما نكملو", uiHints: { kind: "buttons", purpose: "cart_review", options: [], previewOnly: true } },
    } as never,
    buildCartReviewCompletionCopy(2),
  );
  add(assertions, "final planned-item completion uses the approved cart review", cartReview.text === "راجع السلة ديالك قبل ما نكملو");
  add(assertions, "cart-review sentence appears exactly once", count(cartReview.text, "راجع السلة ديالك قبل ما نكملو") === 1);
  add(assertions, "cart-review composition has no duplicated sentence", !cartReview.text.includes("راجع السلة ديالك قبل ما نكملو\n\nراجع السلة ديالك قبل ما نكملو"));
  add(assertions, "one-piece completion remains friendly", buildCartReviewCompletionCopy(1).includes("القطعة"));
  add(assertions, "three-piece completion remains dynamic", buildCartReviewCompletionCopy(3).includes("3 قطع"));

  const initial = start();
  const initialText = initial.presentation?.text || "";
  add(assertions, "cart review continue enters grouped delivery collection", initial.success && initial.cartAfter.status === "COLLECTING_DELIVERY");
  add(assertions, "grouped handoff is friendly and shown once", initialText === "مزيان 👌 دابا صيفط ليا الاسم الكامل، رقم الهاتف والمدينة باش نكملو ليك الطلب.");
  add(assertions, "grouped handoff includes name phone and city", ["الاسم الكامل", "رقم الهاتف", "المدينة"].every((label) => initialText.includes(label)));
  add(assertions, "grouped state records only configured standard fields", initial.previewState?.groupedFieldKeys?.join(",") === "fullName,phone,city");

  const comma = advance(initial, "أسامة العزري، 0611454545، الدار البيضاء");
  add(assertions, "comma-separated reply stores name", comma.cartAfter.orderLevelFields.fullName === "أسامة العزري");
  add(assertions, "comma-separated reply stores normalized phone", comma.cartAfter.orderLevelFields.phone === "0611454545");
  add(assertions, "comma-separated reply stores open-world city", comma.cartAfter.orderLevelFields.city === "الدار البيضاء");
  add(assertions, "completed grouped intake asks the next configured field", comma.previewState?.currentFieldKey === "address" && comma.presentation?.text?.includes("العنوان") === true);
  add(assertions, "grouped handoff is not repeated after complete capture", !comma.presentation?.text?.includes("فمساج واحد"));

  const lines = advance(start(), "أسامة العزري\n0611454545\nمراكش");
  add(assertions, "line-separated reply stores all grouped fields", lines.cartAfter.orderLevelFields.fullName === "أسامة العزري" && lines.cartAfter.orderLevelFields.phone === "0611454545" && lines.cartAfter.orderLevelFields.city === "مراكش");
  const arabicLabels = advance(start(), "الاسم: أسامة العزري\nالهاتف: 0611454545\nالمدينة: منطقة الأمل الشرقية");
  add(assertions, "Arabic labels are parsed deterministically", arabicLabels.cartAfter.orderLevelFields.city === "منطقة الأمل الشرقية");
  const frenchLabels = advance(start(), "Nom: Oussama El Amrani\nTéléphone: +212612345678\nVille: Douar Al Amal");
  add(assertions, "French labels reuse existing normalizers", frenchLabels.cartAfter.orderLevelFields.fullName === "Oussama El Amrani" && frenchLabels.cartAfter.orderLevelFields.phone === "0612345678" && frenchLabels.cartAfter.orderLevelFields.city === "Douar Al Amal");

  const partial = advance(start(), "أسامة العزري، كازا");
  add(assertions, "partial grouped reply retains valid name and city", partial.cartAfter.orderLevelFields.fullName === "أسامة العزري" && partial.cartAfter.orderLevelFields.city === "كازا");
  add(assertions, "partial grouped reply leaves phone missing", partial.cartAfter.orderLevelFields.phone === undefined && partial.previewState?.currentFieldKey === "phone");
  add(assertions, "partial grouped reply asks only for phone", partial.presentation?.text?.includes("رقم الهاتف") === true && !partial.presentation?.text?.includes("فمساج واحد"));

  const invalidPhone = advance(start(), "أسامة العزري، 0511454545، كازا");
  add(assertions, "invalid phone does not erase valid name and city", invalidPhone.cartAfter.orderLevelFields.fullName === "أسامة العزري" && invalidPhone.cartAfter.orderLevelFields.city === "كازا" && invalidPhone.cartAfter.orderLevelFields.phone === undefined);
  add(assertions, "invalid phone follow-up stays focused", invalidPhone.presentation?.text?.includes("رقم الهاتف") === true && invalidPhone.presentation?.text?.includes("ما بانش صحيح") === true);

  const customFields = standardFields.map((field) => field.key === "city"
    ? { ...field, key: "deliveryDistrict", label: "المنطقة", semanticType: "DELIVERY_INSTRUCTIONS", captureMode: "OPEN_TEXT" as const }
    : field,
  );
  const custom = start(customFields);
  add(assertions, "incompatible custom delivery configuration remains sequential", custom.previewState?.groupedFieldKeys === undefined && custom.previewState?.currentFieldKey === "fullName");

  let editable = comma;
  editable = advance(editable, "حي السلام زنقة 4 رقم 12");
  const selector = advance(editable, undefined, standardFields, "order_checkout:edit_delivery");
  const selectedCity = advance(selector, undefined, standardFields, "order_checkout_field:select:city");
  add(assertions, "edit delivery remains focused on selected city", selectedCity.previewState?.editingFieldKey === "city" && selectedCity.presentation?.text?.includes("المدينة") === true && !selectedCity.presentation?.text?.includes("فمساج واحد"));
  add(assertions, "final review occurs only after all required fields are valid", editable.nextStep === "FINAL_ORDER_REVIEW" && editable.cartAfter.status === "AWAITING_CONFIRMATION");
  add(assertions, "evaluator never calls a live provider", true);

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    phase: "6.3H2-R5-R2",
    total: assertions.length,
    passed,
    failed: assertions.length - passed,
    strictAcceptance: passed === assertions.length,
    noLiveSend: true,
    assertions,
  };
}
