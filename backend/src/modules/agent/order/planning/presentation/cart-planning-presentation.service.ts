import type { ProductOfferConfig } from "../../../config/offers/offer.types";
import { MAX_PRODUCT_OFFER_ID_LENGTH } from "../../../config/offers/offer.types";
import type { AgentReplyUiHint } from "../../../reply/reply-renderer.types";
import type {
  CartOfferActionId,
  CartPlanningPresentationResult,
  CartQuantityActionId,
  OfferSelectorPresentationInput,
} from "./cart-planning-presentation.types";
import { MAX_CART_PLANNING_ACTION_ID_LENGTH } from "./cart-planning-presentation.types";

const MAX_BUTTON_OPTIONS = 3;
const MAX_BUTTON_LABEL_LENGTH = 20;
const MAX_LIST_TITLE_LENGTH = 24;
const MAX_LIST_DESCRIPTION_LENGTH = 72;
const OFFER_ACTION_PREFIX = "cart_offer:";
const QUANTITY_ACTION_PREFIX = "cart_quantity:";
const COMMON_QUANTITIES = [1, 2, 3] as const;
const UNSAFE_ACTION_SEGMENT = /[:\s\u0000-\u001F\u007F-\u009F]/u;

const OFFER_PROMPT = "اختار العرض اللي مناسب ليك";
const QUANTITY_PROMPT = "قبل ما نبدأو، شحال من قطعة بغيتي؟";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Code-point truncation preserves valid Unicode without splitting surrogate pairs. */
export function truncatePresentationText(value: string, maximumLength: number): string {
  const normalized = cleanText(value);
  const characters = Array.from(normalized);

  if (characters.length <= maximumLength) {
    return normalized;
  }

  if (maximumLength <= 1) {
    return characters.slice(0, Math.max(0, maximumLength)).join("");
  }

  return `${characters.slice(0, maximumLength - 1).join("").trimEnd()}…`;
}

function formatCurrency(currency: string): string {
  return currency === "MAD" ? "درهم" : currency;
}

function formatPrice(totalPrice: number, currency: string): string {
  const amount = Number.isInteger(totalPrice) ? String(totalPrice) : totalPrice.toFixed(2);
  return `${amount} ${formatCurrency(currency)}`;
}

function formatItemCount(count: number): string {
  if (count === 1) {
    return "1 قطعة";
  }

  if (count === 2) {
    return "قطعتان";
  }

  return `${count} قطع`;
}

function isAvailableAt(offer: ProductOfferConfig, now: Date): boolean {
  if (!offer.active) {
    return false;
  }

  const nowTimestamp = now.getTime();
  if (offer.startsAt && nowTimestamp < Date.parse(offer.startsAt)) {
    return false;
  }

  return !offer.endsAt || nowTimestamp < Date.parse(offer.endsAt);
}

function buildUnavailable(
  failureCode: CartPlanningPresentationResult["failureCode"],
  warnings: string[] = [],
): CartPlanningPresentationResult {
  return {
    success: false,
    kind: "UNAVAILABLE",
    promptKey: "SELECT_OFFER",
    optionCount: 0,
    failureCode,
    warnings,
  };
}

function buildOfferActionId(offerId: string): CartOfferActionId | undefined {
  const id = `${OFFER_ACTION_PREFIX}${offerId}`;
  return (
    offerId.length > 0 &&
    Array.from(offerId).length <= MAX_PRODUCT_OFFER_ID_LENGTH &&
    !UNSAFE_ACTION_SEGMENT.test(offerId) &&
    id.length <= MAX_CART_PLANNING_ACTION_ID_LENGTH
  )
    ? (id as CartOfferActionId)
    : undefined;
}

function buildQuantityActionId(quantity: number): CartQuantityActionId {
  return `${QUANTITY_ACTION_PREFIX}${quantity}` as CartQuantityActionId;
}

function buildOfferOption(offer: ProductOfferConfig): { id: CartOfferActionId; label: string; value: string } | undefined {
  const id = buildOfferActionId(offer.id);
  if (!id) {
    return undefined;
  }

  const displayPrice = formatPrice(offer.totalPrice, offer.currency);
  return {
    id,
    label: `${formatItemCount(offer.requiredItemCount)} — ${displayPrice}`,
    value: `${formatItemCount(offer.requiredItemCount)} — ${displayPrice}`,
  };
}

function cloneUiHint(uiHints: AgentReplyUiHint): AgentReplyUiHint {
  return {
    ...uiHints,
    options: uiHints.options?.map((option) => ({ ...option })),
  };
}

/**
 * Builds presentation-only offer choices from a validated, seller/product
 * scoped lookup. It neither evaluates a cart nor executes planning commands.
 */
export function buildOfferSelectorPresentation(
  input: OfferSelectorPresentationInput,
): CartPlanningPresentationResult {
  if (!Number.isFinite(input.now.getTime())) {
    return buildUnavailable("INVALID_EVALUATION_TIME");
  }

  const sellerId = input.sellerId.trim();
  const productId = input.productContext.productId.trim();
  if (
    !sellerId ||
    sellerId !== input.productContext.sellerId ||
    input.offerLookup.sellerId !== sellerId ||
    input.offerLookup.productId !== productId ||
    input.offerLookup.state === "PRODUCT_NOT_FOUND"
  ) {
    return buildUnavailable("PRODUCT_MISMATCH");
  }

  if (!input.offerLookup.validation.valid || input.offerLookup.state === "INVALID_CONFIGURATION") {
    return buildUnavailable("INVALID_OFFER_CONFIG");
  }

  const seenIds = new Set<string>();
  const options = input.offerLookup.offers
    .filter((offer) => offer.productId === productId && isAvailableAt(offer, input.now))
    .map(buildOfferOption)
    .filter((option): option is NonNullable<typeof option> => Boolean(option))
    .filter((option) => {
      if (seenIds.has(option.id)) {
        return false;
      }

      seenIds.add(option.id);
      return true;
    });

  if (!options.length) {
    return buildUnavailable("NO_AVAILABLE_OFFERS");
  }

  const usesButtons = options.length <= MAX_BUTTON_OPTIONS;
  const uiHints: AgentReplyUiHint = {
    kind: usesButtons ? "buttons" : "list",
    purpose: "order_start",
    title: usesButtons ? undefined : "العروض",
    body: OFFER_PROMPT,
    options: options.map((option) => ({
      id: option.id,
      label: truncatePresentationText(
        usesButtons ? option.label : input.offerLookup.offers.find((offer) => `${OFFER_ACTION_PREFIX}${offer.id}` === option.id)?.label || option.label,
        usesButtons ? MAX_BUTTON_LABEL_LENGTH : MAX_LIST_TITLE_LENGTH,
      ),
      value: truncatePresentationText(option.value, MAX_LIST_DESCRIPTION_LENGTH),
    })),
    previewOnly: true,
  };

  return {
    success: true,
    kind: usesButtons ? "OFFER_BUTTONS" : "OFFER_LIST",
    promptKey: "SELECT_OFFER",
    text: OFFER_PROMPT,
    uiHints: cloneUiHint(uiHints),
    optionCount: options.length,
    warnings: [],
  };
}

/** Builds three common quantity buttons plus a bounded, non-executing more route. */
export function buildStandardQuantitySelectorPresentation(): CartPlanningPresentationResult {
  const options: NonNullable<AgentReplyUiHint["options"]> = COMMON_QUANTITIES.map((quantity) => ({
    id: buildQuantityActionId(quantity),
    label: String(quantity),
    value: String(quantity),
  }));

  // WhatsApp supports three quick-reply buttons. The extra route is explicit
  // metadata for a later list/action-normalization phase, not a fourth button.
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "order_start",
    title: "الكمية",
    body: QUANTITY_PROMPT,
    options,
    previewOnly: true,
  };

  return {
    success: true,
    kind: "QUANTITY_BUTTONS",
    promptKey: "SELECT_QUANTITY",
    text: QUANTITY_PROMPT,
    uiHints: cloneUiHint(uiHints),
    moreQuantityAction: `${QUANTITY_ACTION_PREFIX}more` as CartQuantityActionId,
    optionCount: options.length,
    warnings: [],
  };
}
