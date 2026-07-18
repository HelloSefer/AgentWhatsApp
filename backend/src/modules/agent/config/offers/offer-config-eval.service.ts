import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../product-context.types";
import { OfferConfigService } from "./offer-config.service";
import type { ProductOfferConfig } from "./offer.types";
import { validateAndNormalizeProductOffers } from "./offer-config.validator";

type OfferConfigEvaluationResult = {
  name: string;
  passed: boolean;
  details?: string;
};

function createProduct(input: Partial<ProductContext> = {}): ProductContext {
  return {
    sellerId: "seller-offers-a",
    productId: "product-offers-a",
    name: "منتج تجريبي",
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

function createOffer(input: Partial<ProductOfferConfig> = {}): ProductOfferConfig {
  return {
    id: "offer-two",
    productId: "product-offers-a",
    label: "جوج منتجات",
    requiredItemCount: 2,
    totalPrice: 349,
    currency: "MAD",
    active: true,
    allowMixedOptions: false,
    ...input,
  };
}

function hasCode(result: ReturnType<typeof validateAndNormalizeProductOffers>, code: string): boolean {
  return result.errors.some((error) => error.code === code);
}

/** Permanent focused coverage for offer configuration only; no runtime routing. */
export function evaluateOfferConfigFoundation(): {
  summary: { total: number; passed: number; failed: number; passedAll: boolean };
  results: OfferConfigEvaluationResult[];
} {
  const results: OfferConfigEvaluationResult[] = [];
  const add = (name: string, passed: boolean, details?: string) => results.push({ name, passed, details });
  const product = createProduct();
  const validOffer = createOffer();
  const valid = validateAndNormalizeProductOffers({
    productId: product.productId,
    currency: product.currency,
    offers: [validOffer],
  });

  add("product without offers remains valid", validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency }).valid);
  add("one valid offer normalizes", valid.valid && valid.normalizedOffers.length === 1);
  add("offer identity stays stable", valid.normalizedOffers[0]?.id === validOffer.id);
  add("Arabic offer label is preserved", valid.normalizedOffers[0]?.label === "جوج منتجات");
  add("currency normalization is deterministic", valid.normalizedOffers[0]?.currency === "MAD" && validateAndNormalizeProductOffers({ productId: product.productId, currency: "mad", offers: [createOffer({ currency: "mad" })] }).normalizedOffers[0]?.currency === "MAD");
  add("allowMixedOptions true is preserved", validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ allowMixedOptions: true })] }).normalizedOffers[0]?.allowMixedOptions === true);
  add("allowMixedOptions false is preserved", valid.normalizedOffers[0]?.allowMixedOptions === false);
  add("deterministic ordering uses priority then count then id", (() => {
    const ordered = validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ id: "z", priority: 2 }), createOffer({ id: "b", priority: 1, requiredItemCount: 3 }), createOffer({ id: "a", priority: 1, requiredItemCount: 3 })] }).normalizedOffers;
    return ordered.map((offer) => offer.id).join(",") === "a,b,z";
  })());
  add("duplicate offer ids are rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [validOffer, createOffer()] }), "DUPLICATE_ID"));
  add("empty offer id is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ id: " " })] }), "EMPTY_ID"));
  add("empty label is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ label: " " })] }), "EMPTY_LABEL"));
  add("zero item count is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ requiredItemCount: 0 })] }), "INVALID_REQUIRED_ITEM_COUNT"));
  add("negative item count is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ requiredItemCount: -1 })] }), "INVALID_REQUIRED_ITEM_COUNT"));
  add("decimal item count is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ requiredItemCount: 1.5 })] }), "INVALID_REQUIRED_ITEM_COUNT"));
  add("excessive item count is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ requiredItemCount: 101 })] }), "INVALID_REQUIRED_ITEM_COUNT"));
  add("zero price is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ totalPrice: 0 })] }), "INVALID_TOTAL_PRICE"));
  add("negative price is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ totalPrice: -1 })] }), "INVALID_TOTAL_PRICE"));
  add("non-finite prices are rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ totalPrice: Number.NaN })] }), "INVALID_TOTAL_PRICE") && hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ totalPrice: Number.POSITIVE_INFINITY })] }), "INVALID_TOTAL_PRICE"));
  add("invalid currency is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ currency: "USD" })] }), "INVALID_CURRENCY"));
  add("active must be explicit boolean", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [{ ...createOffer(), active: "true" } as unknown as ProductOfferConfig] }), "INVALID_ACTIVE"));
  add("mixed-option policy must be explicit boolean", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [{ ...createOffer(), allowMixedOptions: "false" } as unknown as ProductOfferConfig] }), "INVALID_ALLOW_MIXED_OPTIONS"));
  add("invalid date window is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ startsAt: "2026-07-20T00:00:00.000Z", endsAt: "2026-07-19T00:00:00.000Z" })] }), "INVALID_AVAILABILITY_WINDOW"));
  add("product id mismatch is rejected", hasCode(validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ productId: "another-product" })] }), "PRODUCT_ID_MISMATCH"));
  add("normalization is idempotent", (() => {
    const once = validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: [createOffer({ id: " offer-two ", label: " جوج منتجات ", currency: "mad", startsAt: "2026-07-18T12:00:00+00:00" })] });
    const twice = validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: once.normalizedOffers });
    return once.valid && twice.valid && JSON.stringify(once.normalizedOffers) === JSON.stringify(twice.normalizedOffers);
  })());
  add("validation does not mutate input", (() => {
    const input = [createOffer({ id: " offer-two ", label: " جوج منتجات ", currency: "mad" })];
    const before = JSON.stringify(input);
    validateAndNormalizeProductOffers({ productId: product.productId, currency: product.currency, offers: input });
    return JSON.stringify(input) === before;
  })());

  const inactiveProduct = createProduct({ offers: [createOffer({ active: false })] });
  const sellerBProduct = createProduct({ sellerId: "seller-offers-b", productId: "product-offers-b", offers: [createOffer({ id: "offer-b", productId: "product-offers-b" })] });
  const lookupService = new OfferConfigService();
  const fixtureContexts = [createProduct({ offers: [validOffer] }), inactiveProduct, sellerBProduct];
  const active = lookupService.getConfiguredOffers({ sellerId: "seller-offers-a", productId: "product-offers-a", productContexts: fixtureContexts });
  const activeOnly = lookupService.getActiveConfiguredOffers({ sellerId: "seller-offers-a", productId: "product-offers-a", productContexts: fixtureContexts });
  const inactive = lookupService.getConfiguredOffers({ sellerId: "seller-offers-a", productId: inactiveProduct.productId, productContexts: [inactiveProduct] });
  const wrongSeller = lookupService.getConfiguredOffers({ sellerId: "seller-offers-a", productId: sellerBProduct.productId, productContexts: fixtureContexts });
  const found = lookupService.findConfiguredOfferById({ sellerId: "seller-offers-a", productId: "product-offers-a", offerId: validOffer.id, productContexts: fixtureContexts });
  add("active lookup returns configured active offers", active.state === "OFFERS_CONFIGURED" && activeOnly.offers.length === 1 && activeOnly.offers[0]?.active === true);
  add("inactive offers remain configured but excluded from active lookup", inactive.state === "OFFERS_CONFIGURED_BUT_INACTIVE" && inactive.offers.length === 1 && inactive.activeOffers.length === 0);
  add("seller and product lookup remains isolated", wrongSeller.state === "PRODUCT_NOT_FOUND");
  add("stable id lookup finds only scoped offer", found.offer?.id === validOffer.id && found.offer?.productId === product.productId);
  add("existing product config without offers is backward compatible", lookupService.getConfiguredOffers({ sellerId: "seller-offers-a", productId: product.productId, productContexts: [createProduct()] }).state === "NO_OFFERS_CONFIGURED");

  const moduleSource = ["offer.types.ts", "offer-config.validator.ts", "offer-config.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "config", "offers", file), "utf8"))
    .join("\n");
  add("offer module has no AI dependency", !/(?:\/ai\/|ollama|generateAIReply|analyzeAIIntent|seller-brain)/i.test(moduleSource));
  add("offer module has no CartDraft mutation dependency", !/(?:CartDraft|cart-state|setCurrentItem|addItem|finalizeCurrentItem)/.test(moduleSource));

  const passed = results.filter((result) => result.passed).length;
  return { summary: { total: results.length, passed, failed: results.length - passed, passedAll: passed === results.length }, results };
}
