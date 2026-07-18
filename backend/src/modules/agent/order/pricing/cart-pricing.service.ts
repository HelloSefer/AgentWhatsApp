import { evaluateCartIntegrity } from "../cart-state.service";
import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductOfferConfig } from "../../config/offers/offer.types";
import { evaluateOfferEligibility } from "./offer-eligibility.service";
import type {
  CartPricingFailure,
  CartPricingInput,
  CartPricingLine,
  CartPricingQuote,
  EligibleOffersPricingResult,
  OfferEligibilityResult,
  OfferPricingEvaluation,
  SelectedOfferPricingResult,
  StandardCartPricingResult,
} from "./cart-pricing.types";

const MONEY_SCALE = 100;

function failure(
  code: CartPricingFailure["code"],
  message: string,
  offerId?: string,
  paths?: string[],
): CartPricingFailure {
  return {
    code,
    message,
    ...(offerId ? { offerId } : {}),
    ...(paths?.length ? { paths: [...paths] } : {}),
  };
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function toMinorUnits(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const scaled = value * MONEY_SCALE;
  const rounded = Math.round(scaled);

  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.0000001) {
    return undefined;
  }

  return rounded;
}

function fromMinorUnits(value: number): number {
  return value / MONEY_SCALE;
}

function safeAdd(left: number, right: number): number | undefined {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : undefined;
}

function safeMultiply(left: number, right: number): number | undefined {
  const total = left * right;
  return Number.isSafeInteger(total) ? total : undefined;
}

function freezeQuote(quote: {
  currency: string;
  totalUnits: number;
  lines: CartPricingLine[];
  standardSubtotal: number;
  appliedOfferId?: string;
  appliedOfferLabel?: string;
  offerTotal?: number;
  discountAmount: number;
  merchandiseTotal: number;
  generatedAt: string;
}): CartPricingQuote {
  const lines = quote.lines.map((line) => Object.freeze({ ...line }));
  return Object.freeze({ ...quote, lines: Object.freeze(lines) });
}

function resolveNow(now?: Date): { now?: Date; failure?: CartPricingFailure } {
  const resolved = now ? new Date(now.getTime()) : new Date();

  if (Number.isNaN(resolved.getTime())) {
    return { failure: failure("INVALID_CLOCK", "Pricing requires a valid evaluation time.") };
  }

  return { now: resolved };
}

function buildOfferLookup(input: CartPricingInput) {
  const service = new OfferConfigService();
  return service.getConfiguredOffers({
    sellerId: input.sellerId,
    productId: input.productContext.productId,
    productContexts: [input.productContext],
  });
}

function standardFailures(input: CartPricingInput): CartPricingFailure[] {
  const failures: CartPricingFailure[] = [];
  const integrity = evaluateCartIntegrity({ cart: input.cart, fields: input.fields });

  if (!integrity.valid) {
    failures.push(failure("INVALID_CART", "Cart integrity validation failed.", undefined, integrity.invalidPaths));
  }

  if (input.cart.items.length === 0) {
    failures.push(failure("EMPTY_CART", "A cart needs at least one completed item."));
  }

  if (input.cart.currentItemDraft) {
    failures.push(failure("INCOMPLETE_CURRENT_ITEM", "Complete the current item before final pricing."));
  }

  if (input.sellerId.trim() !== input.productContext.sellerId.trim()) {
    failures.push(failure("PRODUCT_MISMATCH", "Trusted product configuration does not belong to this seller."));
  }

  if (input.cart.items.some((item) => item.productId !== input.productContext.productId)) {
    failures.push(failure("PRODUCT_MISMATCH", "Every priced cart item must belong to the trusted product."));
  }

  const unitPriceMinor = toMinorUnits(input.productContext.price);
  if (unitPriceMinor === undefined || unitPriceMinor <= 0) {
    failures.push(failure("MISSING_TRUSTED_PRICE", "Trusted product price must be a positive finite money value."));
  }

  if (!/^[A-Z]{3}$/.test(normalizeCurrency(input.productContext.currency))) {
    failures.push(failure("CURRENCY_MISMATCH", "Trusted product currency is invalid."));
  }

  if (input.cart.items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
    failures.push(failure("UNSAFE_MONEY_VALUE", "Cart item quantity is not safe for pricing."));
  }

  return failures;
}

export function calculateStandardCartPricing(input: CartPricingInput): StandardCartPricingResult {
  const failures = standardFailures(input);
  const clock = resolveNow(input.now);
  if (clock.failure) {
    failures.push(clock.failure);
  }

  if (failures.length > 0 || !clock.now) {
    return { ok: false, failures };
  }

  const unitPriceMinor = toMinorUnits(input.productContext.price);
  if (unitPriceMinor === undefined) {
    return { ok: false, failures: [failure("MISSING_TRUSTED_PRICE", "Trusted product price is unavailable.")] };
  }

  const lines: CartPricingLine[] = [];
  let subtotalMinor = 0;
  let totalUnits = 0;

  for (const item of input.cart.items) {
    const lineMinor = safeMultiply(unitPriceMinor, item.quantity);
    const nextSubtotal = lineMinor === undefined ? undefined : safeAdd(subtotalMinor, lineMinor);
    const nextUnits = safeAdd(totalUnits, item.quantity);

    if (lineMinor === undefined || nextSubtotal === undefined || nextUnits === undefined) {
      return { ok: false, failures: [failure("UNSAFE_MONEY_VALUE", "Pricing arithmetic exceeded safe integer bounds.")] };
    }

    subtotalMinor = nextSubtotal;
    totalUnits = nextUnits;
    lines.push({
      cartItemId: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: fromMinorUnits(unitPriceMinor),
      standardLineTotal: fromMinorUnits(lineMinor),
    });
  }

  const standardSubtotal = fromMinorUnits(subtotalMinor);
  return {
    ok: true,
    failures: [],
    quote: freezeQuote({
      currency: normalizeCurrency(input.productContext.currency),
      totalUnits,
      lines,
      standardSubtotal,
      discountAmount: 0,
      merchandiseTotal: standardSubtotal,
      generatedAt: clock.now.toISOString(),
    }),
  };
}

function evaluateOfferPricing(input: {
  pricing: CartPricingInput;
  standardPricing: StandardCartPricingResult;
  offer: ProductOfferConfig;
  offerLookup: ReturnType<typeof buildOfferLookup>;
}): OfferPricingEvaluation {
  const eligibility = evaluateOfferEligibility({
    pricing: input.pricing,
    offerLookup: input.offerLookup,
    offerId: input.offer.id,
  });

  const failures = [...eligibility.failures];
  const standardQuote = input.standardPricing.quote;
  const offerMinor = toMinorUnits(input.offer.totalPrice);
  const subtotalMinor = standardQuote ? toMinorUnits(standardQuote.standardSubtotal) : undefined;

  if (input.standardPricing.ok && (offerMinor === undefined || subtotalMinor === undefined)) {
    failures.push(failure("UNSAFE_MONEY_VALUE", "Offer pricing contains an unsafe money value.", input.offer.id));
  }

  if (offerMinor !== undefined && subtotalMinor !== undefined && offerMinor > subtotalMinor) {
    failures.push(failure("OFFER_TOTAL_EXCEEDS_STANDARD_SUBTOTAL", "Offer total cannot exceed the trusted standard subtotal.", input.offer.id));
  }

  if (!input.standardPricing.ok || !standardQuote || failures.length > 0 || offerMinor === undefined || subtotalMinor === undefined) {
    return {
      offer: { ...input.offer },
      eligibility: { ...eligibility, eligible: false, failures },
    };
  }

  const discountMinor = subtotalMinor - offerMinor;
  const quote = freezeQuote({
    currency: standardQuote.currency,
    totalUnits: standardQuote.totalUnits,
    lines: standardQuote.lines.map((line) => ({ ...line })),
    standardSubtotal: standardQuote.standardSubtotal,
    appliedOfferId: input.offer.id,
    appliedOfferLabel: input.offer.label,
    offerTotal: fromMinorUnits(offerMinor),
    discountAmount: fromMinorUnits(discountMinor),
    merchandiseTotal: fromMinorUnits(offerMinor),
    generatedAt: standardQuote.generatedAt,
  });

  return {
    offer: { ...input.offer },
    eligibility: { ...eligibility, eligible: true, failures: [] },
    quote,
  };
}

function unknownOfferEligibility(offerId: string): OfferEligibilityResult {
  return {
    eligible: false,
    offerId,
    totalUnits: 0,
    failures: [failure("OFFER_NOT_FOUND", "The selected offer was not found for this product.", offerId || undefined)],
  };
}

export function evaluateAllEligibleOffers(input: CartPricingInput): EligibleOffersPricingResult {
  const standardPricing = calculateStandardCartPricing(input);
  const offerLookup = buildOfferLookup(input);

  if (!standardPricing.ok || offerLookup.state === "INVALID_CONFIGURATION" || offerLookup.state === "PRODUCT_NOT_FOUND") {
    return {
      standardPricing,
      evaluations: [],
      eligibleOffers: [],
    };
  }

  const evaluations = offerLookup.offers.map((offer) => evaluateOfferPricing({
    pricing: input,
    standardPricing,
    offer,
    offerLookup,
  }));
  const eligibleOffers = evaluations.filter((evaluation) => evaluation.eligibility.eligible);

  return {
    standardPricing,
    evaluations,
    eligibleOffers,
    recommendedOffer: eligibleOffers[0],
  };
}

export function calculateSelectedOfferPricing(input: CartPricingInput & { offerId: string }): SelectedOfferPricingResult {
  const standardPricing = calculateStandardCartPricing(input);
  const offerLookup = buildOfferLookup(input);
  const offerId = input.offerId.trim();
  const offer = offerLookup.offers.find((candidate) => candidate.id === offerId);

  if (!offer) {
    const eligibility = offerLookup.state === "INVALID_CONFIGURATION"
      ? {
          eligible: false,
          offerId,
          totalUnits: standardPricing.quote?.totalUnits || 0,
          failures: [failure("INVALID_OFFER_CONFIG", "Offer configuration is invalid.", offerId || undefined)],
        }
      : unknownOfferEligibility(offerId);
    return { standardPricing, offerEligibility: eligibility };
  }

  const evaluation = evaluateOfferPricing({ pricing: input, standardPricing, offer, offerLookup });
  return {
    standardPricing,
    offerEligibility: evaluation.eligibility,
    quote: evaluation.quote,
  };
}
