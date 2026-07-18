import { createItemFingerprint, evaluateCartIntegrity } from "../cart-state.service";
import type { ProductOfferLookupResult } from "../../config/offers/offer-config.service";
import type { ProductOfferConfig } from "../../config/offers/offer.types";
import type { CartPricingFailure, CartPricingInput, OfferEligibilityResult } from "./cart-pricing.types";

function failure(
  code: CartPricingFailure["code"],
  message: string,
  offerId?: string,
  paths?: string[],
): CartPricingFailure {
  return { code, message, ...(offerId ? { offerId } : {}), ...(paths?.length ? { paths: [...paths] } : {}) };
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function totalCompletedUnits(input: CartPricingInput): number {
  return input.cart.items.reduce((total, item) => total + item.quantity, 0);
}

function resolveNow(now?: Date): { now?: Date; failure?: CartPricingFailure } {
  const resolved = now ? new Date(now.getTime()) : new Date();

  if (Number.isNaN(resolved.getTime())) {
    return { failure: failure("INVALID_CLOCK", "Pricing requires a valid evaluation time.") };
  }

  return { now: resolved };
}

/**
 * Pure runtime eligibility only. It consumes B1's validated lookup result and
 * does not select offers, calculate money, or mutate any cart state.
 */
export function evaluateOfferEligibility(input: {
  pricing: CartPricingInput;
  offerLookup: ProductOfferLookupResult;
  offerId: string;
}): OfferEligibilityResult {
  const offerId = input.offerId.trim();
  const failures: CartPricingFailure[] = [];
  const { pricing, offerLookup } = input;
  const totalUnits = totalCompletedUnits(pricing);
  const offer = offerLookup.offers.find((candidate) => candidate.id === offerId);

  if (offerLookup.state === "INVALID_CONFIGURATION") {
    failures.push(failure("INVALID_OFFER_CONFIG", "Offer configuration is invalid.", offerId || undefined));
  }

  if (offerLookup.state === "PRODUCT_NOT_FOUND") {
    failures.push(failure("PRODUCT_MISMATCH", "Offer configuration does not belong to the current seller and product.", offerId || undefined));
  }

  if (!offer) {
    failures.push(failure("OFFER_NOT_FOUND", "The selected offer was not found for this product.", offerId || undefined));
  }

  const integrity = evaluateCartIntegrity({ cart: pricing.cart, fields: pricing.fields });
  if (!integrity.valid) {
    failures.push(failure("INVALID_CART", "Cart integrity validation failed.", offerId || undefined, integrity.invalidPaths));
  }

  if (pricing.cart.items.length === 0) {
    failures.push(failure("EMPTY_CART", "A cart needs at least one completed item.", offerId || undefined));
  }

  if (pricing.cart.currentItemDraft) {
    failures.push(failure("INCOMPLETE_CURRENT_ITEM", "Complete the current item before applying an offer.", offerId || undefined));
  }

  if (pricing.cart.items.some((item) => item.productId !== pricing.productContext.productId)) {
    failures.push(failure("PRODUCT_MISMATCH", "Every priced cart item must belong to the configured product.", offerId || undefined));
  }

  if (!offer) {
    return { eligible: false, offerId, totalUnits, failures };
  }

  if (!offer.active) {
    failures.push(failure("OFFER_INACTIVE", "The selected offer is inactive.", offer.id));
  }

  const clock = resolveNow(pricing.now);
  if (clock.failure) {
    failures.push({ ...clock.failure, offerId: offer.id });
  } else if (clock.now) {
    const now = clock.now.getTime();
    if (offer.startsAt && now < Date.parse(offer.startsAt)) {
      failures.push(failure("OFFER_NOT_STARTED", "The selected offer has not started yet.", offer.id));
    }
    if (offer.endsAt && now >= Date.parse(offer.endsAt)) {
      failures.push(failure("OFFER_EXPIRED", "The selected offer has expired.", offer.id));
    }
  }

  if (normalizeCurrency(offer.currency) !== normalizeCurrency(pricing.productContext.currency)) {
    failures.push(failure("CURRENCY_MISMATCH", "Offer currency does not match trusted product currency.", offer.id));
  }

  if (totalUnits !== offer.requiredItemCount) {
    failures.push(failure("ITEM_COUNT_MISMATCH", "Completed item quantities do not match the offer requirement.", offer.id));
  }

  if (!offer.allowMixedOptions) {
    const fingerprints = new Set(pricing.cart.items.map(createItemFingerprint));
    if (fingerprints.size > 1) {
      failures.push(failure("MIXED_OPTIONS_NOT_ALLOWED", "The selected offer requires matching item options.", offer.id));
    }
  }

  return {
    eligible: failures.length === 0,
    offerId: offer.id,
    offer: { ...offer },
    totalUnits,
    failures,
  };
}

