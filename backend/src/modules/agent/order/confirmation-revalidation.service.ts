import { createHash } from "node:crypto";
import { hydrateCartProductAuthority } from "./cart-state.service";
import type { CartDraft } from "./cart-state.types";
import type { ProductContext } from "../config/product-context.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import { offerConfigService } from "../config/offers/offer-config.service";
import { evaluateCartCommercialState } from "./commercial/cart-commercial-evaluation.service";

export type ConfirmationRevalidationResult = Readonly<{
  status: "UNCHANGED" | "REVIEW_REQUIRED" | "CORRECTION_REQUIRED" | "BLOCKED";
  cart: CartDraft;
  fingerprint?: string;
  reason: "BINDING_CHANGED" | "PRODUCT_UNAVAILABLE" | "INVALID_SELECTION" | "COMMERCIAL_FACT_CHANGED" | "VALID";
}>;

export function createCartReviewFingerprint(input: { cart: CartDraft; productContext: ProductContext; selectedOfferId?: string }): string {
  const facts = input.cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    unitPriceAmountMinor: item.unitPriceAmountMinor,
    currencyCode: item.currencyCode,
    options: item.selectedOptionFacts?.map(({ optionId, valueId }) => ({ optionId, valueId })),
  }));
  return createHash("sha256").update(JSON.stringify({ productId: input.productContext.productId, price: input.productContext.priceAmountMinor, offers: input.productContext.offers?.map((offer) => ({ id: offer.id, total: offer.totalPriceAmountMinor, active: offer.active, startsAt: offer.startsAt, endsAt: offer.endsAt })), selectedOfferId: input.selectedOfferId, facts })).digest("hex");
}

/** Rebuilds temporary cart facts from the current bound Catalog projection. */
export function revalidateCartBeforeConfirmation(input: {
  cart: CartDraft;
  expectedProductId: string;
  sellerId: string;
  productContext?: ProductContext;
  fields: RequiredOrderField[];
  now: Date;
}): ConfirmationRevalidationResult {
  if (!input.productContext || !input.productContext.active) {
    return { status: "BLOCKED", cart: input.cart, reason: "PRODUCT_UNAVAILABLE" };
  }
  if (input.productContext.productId !== input.expectedProductId || input.cart.items.some((item) => item.productId !== input.productContext!.productId)) {
    return { status: "BLOCKED", cart: input.cart, reason: "BINDING_CHANGED" };
  }
  const hydrated = hydrateCartProductAuthority({ cart: input.cart, productContext: input.productContext });
  if (!hydrated.valid) {
    return { status: "CORRECTION_REQUIRED", cart: hydrated.cart, reason: "INVALID_SELECTION" };
  }
  const offerLookup = offerConfigService.getConfiguredOffers({ sellerId: input.sellerId, productId: input.productContext.productId, productContexts: [input.productContext] });
  const commercial = evaluateCartCommercialState({ sellerId: input.sellerId, productContext: input.productContext, cart: hydrated.cart, fields: input.fields, offerLookup, now: input.now });
  if (!commercial.standardPricing || commercial.selectedOffer?.eligible === false) {
    return { status: "REVIEW_REQUIRED", cart: hydrated.cart, reason: "COMMERCIAL_FACT_CHANGED" };
  }
  const nextFingerprint = createCartReviewFingerprint({ cart: hydrated.cart, productContext: input.productContext, selectedOfferId: commercial.selectedOffer?.offerId });
  const previousFingerprint = input.cart.reviewFingerprint;
  hydrated.cart.reviewFingerprint = nextFingerprint;
  return { status: !previousFingerprint || previousFingerprint === nextFingerprint ? "UNCHANGED" : "REVIEW_REQUIRED", cart: hydrated.cart, fingerprint: nextFingerprint, reason: previousFingerprint ? "COMMERCIAL_FACT_CHANGED" : "VALID" };
}
