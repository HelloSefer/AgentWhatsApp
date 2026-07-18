import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../../config/offers/offer-config.service";
import type { ProductOfferConfig } from "../../../config/offers/offer.types";
import type { ProductContext } from "../../../config/product-context.types";
import {
  buildOfferSelectorPresentation,
  buildStandardQuantitySelectorPresentation,
  truncatePresentationText,
} from "./cart-planning-presentation.service";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartPlanningPresentationEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "presentation-seller";
const productId = "presentation-product";
const now = new Date("2026-07-18T12:00:00.000Z");

function offer(input: Partial<ProductOfferConfig> = {}): ProductOfferConfig {
  return {
    id: "offer-one",
    productId,
    label: "عرض قطعة واحدة",
    requiredItemCount: 1,
    totalPrice: 199,
    currency: "MAD",
    active: true,
    allowMixedOptions: true,
    priority: 10,
    ...input,
  };
}

function product(input: Partial<ProductContext> = {}): ProductContext {
  return {
    sellerId,
    productId,
    name: "منتج العرض",
    price: 199,
    currency: "MAD",
    active: true,
    images: [],
    benefits: [],
    optionGroups: [],
    infoMenu: [],
    stock: { enabled: false, status: "AVAILABLE" },
    ...input,
  };
}

function presentationInput(currentProduct: ProductContext, input: Record<string, unknown> = {}) {
  const lookup = new OfferConfigService().getConfiguredOffers({
    sellerId: currentProduct.sellerId,
    productId: currentProduct.productId,
    productContexts: [currentProduct],
  });

  return {
    sellerId: currentProduct.sellerId,
    productContext: currentProduct,
    offerLookup: lookup,
    now,
    ...input,
  } as Parameters<typeof buildOfferSelectorPresentation>[0];
}

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

/** Permanent pure regression suite for offer/quantity selector metadata. */
export function evaluateCartPlanningPresentation(): CartPlanningPresentationEvaluationResult {
  const cases: EvaluationCase[] = [];
  const oneOfferProduct = product({ offers: [offer()] });
  const one = buildOfferSelectorPresentation(presentationInput(oneOfferProduct));
  add(cases, "one visible offer produces buttons", one.success && one.kind === "OFFER_BUTTONS" && one.optionCount === 1);
  add(cases, "stable offer action id uses offer id only", one.uiHints?.options?.[0]?.id === "cart_offer:offer-one");
  add(cases, "offer action id does not contain price or label", !one.uiHints?.options?.[0]?.id.includes("199") && !one.uiHints?.options?.[0]?.id.includes("عرض"));
  add(cases, "trusted config price is displayed", one.uiHints?.options?.[0]?.label.includes("199") === true && one.uiHints?.options?.[0]?.label.includes("درهم") === true);

  const threeOfferProduct = product({
    offers: [
      offer({ id: "offer-three", requiredItemCount: 3, totalPrice: 459, priority: 30 }),
      offer({ id: "offer-one", requiredItemCount: 1, totalPrice: 199, priority: 10 }),
      offer({ id: "offer-two", requiredItemCount: 2, totalPrice: 349, priority: 20 }),
    ],
  });
  const three = buildOfferSelectorPresentation(presentationInput(threeOfferProduct));
  add(cases, "three visible offers produce buttons", three.success && three.kind === "OFFER_BUTTONS" && three.optionCount === 3);
  add(cases, "B1 priority ordering is preserved", three.uiHints?.options?.map((item) => item.id).join(",") === "cart_offer:offer-one,cart_offer:offer-two,cart_offer:offer-three");

  const fourOfferProduct = product({
    offers: [...threeOfferProduct.offers!, offer({ id: "offer-four", requiredItemCount: 4, totalPrice: 560, priority: 40, label: "Four pack" })],
  });
  const four = buildOfferSelectorPresentation(presentationInput(fourOfferProduct));
  add(cases, "four visible offers produce a list", four.success && four.kind === "OFFER_LIST" && four.uiHints?.kind === "list");
  add(cases, "four-plus boundary uses list", four.optionCount === 4);

  const inactive = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ active: false })] })));
  add(cases, "inactive offers are excluded", !inactive.success && inactive.failureCode === "NO_AVAILABLE_OFFERS");
  const future = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ startsAt: "2026-08-01T00:00:00.000Z" })] })));
  add(cases, "future offers are excluded", !future.success && future.failureCode === "NO_AVAILABLE_OFFERS");
  const expired = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ endsAt: "2026-07-01T00:00:00.000Z" })] })));
  add(cases, "expired offers are excluded", !expired.success && expired.failureCode === "NO_AVAILABLE_OFFERS");
  const timed = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ startsAt: "2026-07-18T12:00:00.000Z" })] })));
  add(cases, "explicit evaluation time controls availability", timed.success);

  const invalid = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ totalPrice: 0 })] })));
  add(cases, "invalid configuration produces no unsafe options", !invalid.success && invalid.failureCode === "INVALID_OFFER_CONFIG" && invalid.optionCount === 0);
  const noOffers = buildOfferSelectorPresentation(presentationInput(product({ offers: [] })));
  add(cases, "no offers returns typed unavailable result", !noOffers.success && noOffers.kind === "UNAVAILABLE" && noOffers.failureCode === "NO_AVAILABLE_OFFERS");
  const unsafeId = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ id: "offer:349" })] })));
  add(cases, "unsafe offer action id is never presented", !unsafeId.success && unsafeId.failureCode === "NO_AVAILABLE_OFFERS" && unsafeId.optionCount === 0);

  const duplicateIds = four.uiHints?.options?.map((item) => item.id) || [];
  add(cases, "duplicate presentation ids cannot occur", new Set(duplicateIds).size === duplicateIds.length);
  const arabicList = buildOfferSelectorPresentation(presentationInput(product({
    offers: [
      offer({ id: "arabic", label: "عرض وردي خاص", priority: 1 }),
      offer({ id: "two", label: "عرض ثنائي", priority: 2 }),
      offer({ id: "three", label: "عرض ثلاثي", priority: 3 }),
      offer({ id: "four", label: "عرض رباعي", priority: 4 }),
    ],
  })));
  add(cases, "Arabic labels are preserved in list rows", arabicList.uiHints?.kind === "list" && arabicList.uiHints.options?.[0]?.label === "عرض وردي خاص");
  const multilingual = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ label: "Pack Premium / Offre" })] })));
  add(cases, "French and English labels are preserved in list rows", buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ id: "a", label: "Pack Premium / Offre", priority: 1 }), offer({ id: "b", label: "Deux", priority: 2 }), offer({ id: "c", label: "Three", priority: 3 }), offer({ id: "d", label: "Four", priority: 4 })] }))).uiHints?.options?.[0]?.label.includes("Pack Premium") === true && multilingual.success);
  const longLabel = "عرض طويل جداً ".repeat(30);
  const long = buildOfferSelectorPresentation(presentationInput(product({ offers: [offer({ label: longLabel })] })));
  add(cases, "long labels are safely bounded", (long.uiHints?.options?.[0]?.label.length || 0) <= 20);
  const unicode = truncatePresentationText("😀😀😀😀", 3);
  add(cases, "Unicode truncation remains valid", unicode === "😀😀…" && !/\uD800-\uDBFF(?![\uDC00-\uDFFF])/.test(unicode));

  const quantity = buildStandardQuantitySelectorPresentation();
  const quantityIds = quantity.uiHints?.options?.map((item) => item.id) || [];
  add(cases, "quantity selector exposes 1, 2, and 3", quantityIds.includes("cart_quantity:1") && quantityIds.includes("cart_quantity:2") && quantityIds.includes("cart_quantity:3"));
  add(cases, "quantity action ids are stable", quantityIds.slice(0, 3).join(",") === "cart_quantity:1,cart_quantity:2,cart_quantity:3");
  add(cases, "quantity action ids contain only normalized quantity", quantityIds.slice(0, 3).every((id) => /^cart_quantity:[1-3]$/.test(id)));
  add(cases, "more quantity route is present and safely identified", quantity.moreQuantityAction === "cart_quantity:more");
  add(cases, "no excessive number of quick buttons is produced", quantity.kind === "QUANTITY_BUTTONS" && quantity.optionCount === 3 && quantity.uiHints?.kind === "buttons");

  const sourceProduct = product({ offers: [offer()] });
  const sourceBefore = JSON.stringify(sourceProduct);
  buildOfferSelectorPresentation(presentationInput(sourceProduct));
  add(cases, "builder does not mutate offer config", JSON.stringify(sourceProduct) === sourceBefore);
  const sellerTwoProduct = product({ sellerId: "seller-two", productId: "product-two", offers: [offer({ productId: "product-two" })] });
  const sellerTwo = buildOfferSelectorPresentation(presentationInput(sellerTwoProduct));
  add(cases, "seller and product isolation is preserved", sellerTwo.success && sellerTwo.uiHints?.options?.[0]?.id === "cart_offer:offer-one" && sellerTwoProduct.sellerId !== oneOfferProduct.sellerId);
  const repeatedOne = buildOfferSelectorPresentation(presentationInput(oneOfferProduct));
  add(cases, "repeated calls are deterministic", JSON.stringify(one) === JSON.stringify(repeatedOne));
  add(cases, "metadata uses existing uiHints preview convention", one.uiHints?.purpose === "order_start" && one.uiHints?.previewOnly === true);

  const moduleSource = ["cart-planning-presentation.types.ts", "cart-planning-presentation.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "planning", "presentation", file), "utf8"))
    .join("\n");
  add(cases, "builder has no cart mutation dependency", !/(cart-state\.service|setCartPlanning|clearCartPlanning|CartDraft)/i.test(moduleSource));
  add(cases, "builder has no pricing calculation dependency", !/(pricing\/|calculate|merchandiseTotal|deliveryTotal)/i.test(moduleSource));
  add(cases, "builder has no AI, WhatsApp transport, receipt, Valkey, or DB dependency", !/from\s+["'][^"']*(?:ollama|openai|whatsapp|receipt|valkey|redis|database|prisma|typeorm)/i.test(moduleSource));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
