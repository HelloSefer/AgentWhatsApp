import { evaluateCartIntegrity } from "../cart-state.service";
import {
  calculateSelectedOfferPricing,
  evaluateAllEligibleOffers,
} from "../pricing/cart-pricing.service";
import type { CartPricingFailure, CartPricingQuote } from "../pricing/cart-pricing.types";
import type {
  CartCommercialEvaluation,
  CartCommercialEvaluationComparison,
  CartCommercialEvaluationInput,
  CartCommercialState,
  CommercialOfferQuote,
  SelectedCommercialOffer,
} from "./cart-commercial-evaluation.types";

function failure(
  code: CartPricingFailure["code"],
  message: string,
): CartPricingFailure {
  return { code, message };
}

function cloneQuote(quote: CartPricingQuote): CartPricingQuote {
  const lines = quote.lines.map((line) => Object.freeze({ ...line }));
  return Object.freeze({ ...quote, lines: Object.freeze(lines) });
}

function cloneFailure(value: CartPricingFailure): CartPricingFailure {
  return Object.freeze({ ...value, ...(value.paths ? { paths: Object.freeze([...value.paths]) as unknown as string[] } : {}) });
}

function freezeOfferQuote(input: { offerId: string; pricing: CartPricingQuote }): CommercialOfferQuote {
  return Object.freeze({ offerId: input.offerId, pricing: cloneQuote(input.pricing) });
}

function resolveEvaluatedAt(now: Date): string {
  return Number.isNaN(now.getTime()) ? "" : new Date(now.getTime()).toISOString();
}

function hasMatchingLookupScope(input: CartCommercialEvaluationInput): boolean {
  return (
    input.offerLookup.sellerId === input.sellerId.trim() &&
    input.offerLookup.productId === input.productContext.productId.trim()
  );
}

function buildState(input: {
  cartValid: boolean;
  standardPricing?: CartPricingQuote;
  selectedOffer?: SelectedCommercialOffer;
  eligibleOffers: readonly CommercialOfferQuote[];
  offerState: CartCommercialEvaluationInput["offerLookup"]["state"];
}): CartCommercialState {
  if (input.selectedOffer) {
    return input.selectedOffer.eligible
      ? "SELECTED_OFFER_ELIGIBLE"
      : "SELECTED_OFFER_INELIGIBLE";
  }

  if (!input.cartValid || !input.standardPricing) {
    return "COMMERCIAL_EVALUATION_BLOCKED";
  }

  if (input.offerState === "NO_OFFERS_CONFIGURED") {
    return "NO_OFFERS_CONFIGURED";
  }

  return input.eligibleOffers.length > 0 ? "OFFER_AVAILABLE" : "STANDARD_ONLY";
}

function freezeEvaluation(input: {
  evaluatedAt: string;
  state: CartCommercialState;
  cartValid: boolean;
  cartIntegrityErrors: string[];
  standardPricing?: CartPricingQuote;
  selectedOffer?: SelectedCommercialOffer;
  eligibleOffers: CommercialOfferQuote[];
  recommendedOffer?: CommercialOfferQuote;
  warnings: string[];
  failures: CartPricingFailure[];
}): CartCommercialEvaluation {
  return Object.freeze({
    evaluatedAt: input.evaluatedAt,
    state: input.state,
    cartValid: input.cartValid,
    cartIntegrityErrors: Object.freeze([...input.cartIntegrityErrors]),
    ...(input.standardPricing ? { standardPricing: cloneQuote(input.standardPricing) } : {}),
    ...(input.selectedOffer
      ? {
          selectedOffer: Object.freeze({
            ...input.selectedOffer,
            ...(input.selectedOffer.pricing ? { pricing: cloneQuote(input.selectedOffer.pricing) } : {}),
          }),
        }
      : {}),
    eligibleOffers: Object.freeze(input.eligibleOffers.map((offer) => freezeOfferQuote(offer))),
    ...(input.recommendedOffer ? { recommendedOffer: freezeOfferQuote(input.recommendedOffer) } : {}),
    warnings: Object.freeze([...input.warnings]),
    failures: Object.freeze(input.failures.map(cloneFailure)),
  });
}

/**
 * Read-only orchestration boundary over the current cart. It deliberately
 * never writes back pricing, selected offers, targets, or cart mutations.
 */
export function evaluateCartCommercialState(
  input: CartCommercialEvaluationInput,
): CartCommercialEvaluation {
  const integrity = evaluateCartIntegrity({ cart: input.cart, fields: input.fields });
  const evaluatedAt = resolveEvaluatedAt(input.now);
  const warnings: string[] = [];
  const failures: CartPricingFailure[] = [];
  const lookupScopeMatches = hasMatchingLookupScope(input);

  if (!lookupScopeMatches) {
    failures.push(failure("PRODUCT_MISMATCH", "Offer lookup does not match the trusted seller and product context."));
  }

  if (input.offerLookup.state === "INVALID_CONFIGURATION") {
    failures.push(failure("INVALID_OFFER_CONFIG", "Offer configuration is invalid."));
  }

  if (input.offerLookup.state === "OFFERS_CONFIGURED_BUT_INACTIVE") {
    warnings.push("offers_configured_but_inactive");
  }

  const pricingInput = {
    sellerId: input.sellerId,
    productContext: input.productContext,
    cart: input.cart,
    fields: input.fields,
    now: input.now,
  };
  const allOffers = evaluateAllEligibleOffers(pricingInput);
  const standardPricing = allOffers.standardPricing;
  failures.push(...standardPricing.failures.map(cloneFailure));

  if (!integrity.valid && !failures.some((entry) => entry.code === "INVALID_CART")) {
    failures.push({
      code: "INVALID_CART",
      message: "Cart integrity validation failed.",
      paths: [...integrity.invalidPaths],
    });
  }

  const eligibleOffers = lookupScopeMatches
    ? allOffers.eligibleOffers
        .filter((evaluation) => evaluation.quote)
        .map((evaluation) => freezeOfferQuote({ offerId: evaluation.offer.id, pricing: evaluation.quote! }))
    : [];
  const recommendedOffer = lookupScopeMatches && allOffers.recommendedOffer?.quote
    ? freezeOfferQuote({
        offerId: allOffers.recommendedOffer.offer.id,
        pricing: allOffers.recommendedOffer.quote,
      })
    : undefined;

  let selectedOffer: SelectedCommercialOffer | undefined;
  if (input.cart.selectedOfferId) {
    const selected = calculateSelectedOfferPricing({
      ...pricingInput,
      offerId: input.cart.selectedOfferId,
    });
    const selectedFailures = selected.offerEligibility.failures.map(cloneFailure);
    failures.push(...selectedFailures);
    selectedOffer = Object.freeze({
      offerId: input.cart.selectedOfferId,
      eligible: selected.offerEligibility.eligible,
      ...(selected.quote ? { pricing: cloneQuote(selected.quote) } : {}),
      ...(selectedFailures[0] ? { failureCode: selectedFailures[0].code } : {}),
    });
  }

  const state = buildState({
    cartValid: integrity.valid,
    standardPricing: standardPricing.quote,
    selectedOffer,
    eligibleOffers,
    offerState: input.offerLookup.state,
  });

  return freezeEvaluation({
    evaluatedAt,
    state,
    cartValid: integrity.valid,
    cartIntegrityErrors: integrity.invalidPaths,
    ...(standardPricing.quote ? { standardPricing: standardPricing.quote } : {}),
    ...(selectedOffer ? { selectedOffer } : {}),
    eligibleOffers,
    ...(recommendedOffer ? { recommendedOffer } : {}),
    warnings,
    failures,
  });
}

/** Pure comparison; callers may supply any two independently evaluated cart states. */
export function compareCommercialEvaluations(
  previous: CartCommercialEvaluation,
  current: CartCommercialEvaluation,
): CartCommercialEvaluationComparison {
  const previousEligible = new Set(previous.eligibleOffers.map((offer) => offer.offerId));
  const currentEligible = new Set(current.eligibleOffers.map((offer) => offer.offerId));
  const offerGained = [...currentEligible].some((offerId) => !previousEligible.has(offerId));
  const offerLost = [...previousEligible].some((offerId) => !currentEligible.has(offerId));
  const selectedOfferBecameIneligible = Boolean(
    previous.selectedOffer?.eligible &&
      current.selectedOffer &&
      previous.selectedOffer.offerId === current.selectedOffer.offerId &&
      !current.selectedOffer.eligible,
  );
  const previousRecommendedOfferId = previous.recommendedOffer?.offerId;
  const currentRecommendedOfferId = current.recommendedOffer?.offerId;
  const meaningfulChange =
    offerGained ||
    offerLost ||
    selectedOfferBecameIneligible ||
    previous.state !== current.state ||
    previousRecommendedOfferId !== currentRecommendedOfferId;
  const state = selectedOfferBecameIneligible
    ? "SELECTED_OFFER_BECAME_INELIGIBLE"
    : offerGained && !offerLost
      ? "OFFER_GAINED_AFTER_CART_CHANGE"
      : offerLost && !offerGained
        ? "OFFER_LOST_AFTER_CART_CHANGE"
        : meaningfulChange
          ? "COMMERCIAL_STATE_CHANGED"
          : "NO_MEANINGFUL_CHANGE";

  return Object.freeze({
    state,
    offerGained,
    offerLost,
    selectedOfferBecameIneligible,
    meaningfulChange,
    ...(previousRecommendedOfferId ? { previousRecommendedOfferId } : {}),
    ...(currentRecommendedOfferId ? { currentRecommendedOfferId } : {}),
  });
}

