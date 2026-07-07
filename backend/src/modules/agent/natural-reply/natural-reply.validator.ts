import { colorDefinitions } from "../direct-answer/attribute-definitions";
import {
  normalizeComparable,
  normalizeText,
} from "../direct-answer/text-normalization";
import type { ProductContext } from "../product-context.types";

export interface NaturalReplyValidationResult {
  isValid: boolean;
  reason?: string;
}

const maxReplyLength = 260;

function hasAny(text: string, terms: string[]): boolean {
  const normalizedText = normalizeText(text);

  return terms.some((term) => normalizedText.includes(normalizeText(term)));
}

function getAvailableColors(productContext: ProductContext): string[] {
  return productContext.availableColors?.filter(Boolean) || [];
}

function getAvailableSizes(productContext: ProductContext): string[] {
  return productContext.availableSizes?.filter(Boolean) || [];
}

function hasStoreAddress(productContext: ProductContext): boolean {
  return Boolean(
    productContext.attributes?.storeLocation ||
      productContext.attributes?.["store_location"] ||
      productContext.attributes?.["عنوان المحل"] ||
      productContext.attributes?.["المحل"],
  );
}

function hasDeliveryFreeFact(productContext: ProductContext): boolean {
  return hasAny(
    [
      productContext.deliveryInfo,
      ...(productContext.extraNotes || []),
      ...(productContext.features || []),
      productContext.attributes?.deliveryCost,
      productContext.attributes?.["delivery_cost"],
      productContext.attributes?.["ثمن التوصيل"],
      productContext.attributes?.["تمن التوصيل"],
    ]
      .filter(Boolean)
      .join(" "),
    ["مجاني", "free", "gratuit"],
  );
}

function hasDiscountFact(productContext: ProductContext): boolean {
  return hasAny(
    [
      productContext.offer,
      ...(productContext.extraNotes || []),
      ...(productContext.features || []),
    ]
      .filter(Boolean)
      .join(" "),
    ["تخفيض", "خصم", "discount", "promo", "عرض"],
  );
}

function hasReviewFact(productContext: ProductContext): boolean {
  return hasAny(
    [
      ...(productContext.extraNotes || []),
      ...(productContext.features || []),
      ...(productContext.faqs || []).flatMap((faq) => [faq.question, faq.answer]),
    ]
      .filter(Boolean)
      .join(" "),
    ["رأي", "آراء", "تقييم", "زبناء", "reviews", "avis", "testimonials"],
  );
}

function mentionsUnavailableColor(
  reply: string,
  productContext: ProductContext,
): boolean {
  const availableColors = getAvailableColors(productContext);

  if (!availableColors.length) {
    return false;
  }

  return colorDefinitions.some((definition) => {
    const isAvailable = availableColors.some((availableColor) =>
      definition.values.some(
        (value) =>
          normalizeComparable(value) === normalizeComparable(availableColor),
      ),
    );

    if (isAvailable) {
      return false;
    }

    const mentionsColor = definition.values.some((value) =>
      hasAny(reply, [value]),
    );

    return (
      mentionsColor &&
      hasAny(reply, ["متوفر", "كاين", "كاينة", "available", "disponible"])
    );
  });
}

function mentionsUnavailableSize(
  reply: string,
  productContext: ProductContext,
): boolean {
  const availableSizes = getAvailableSizes(productContext);

  if (!availableSizes.length) {
    return false;
  }

  const sizeMatches = reply.match(/\b(3[6-9]|4[0-5])\b/g) || [];

  return sizeMatches.some(
    (size) =>
      !availableSizes.some(
        (availableSize) =>
          normalizeComparable(availableSize) === normalizeComparable(size),
      ) &&
      hasAny(reply, ["متوفر", "كاين", "كاينة", "available", "disponible"]),
  );
}

function sentenceCount(reply: string): number {
  return reply.match(/[^.!؟?]+[.!؟?]*/g)?.length || 0;
}

export function validateNaturalReply(
  reply: string,
  productContext: ProductContext,
): NaturalReplyValidationResult {
  const trimmedReply = reply.trim();

  if (!trimmedReply) {
    return { isValid: false, reason: "empty_reply" };
  }

  if (trimmedReply.length > maxReplyLength) {
    return { isValid: false, reason: "reply_too_long" };
  }

  if (sentenceCount(trimmedReply) > 2) {
    return { isValid: false, reason: "too_many_sentences" };
  }

  if (mentionsUnavailableColor(trimmedReply, productContext)) {
    return { isValid: false, reason: "mentions_unavailable_color" };
  }

  if (mentionsUnavailableSize(trimmedReply, productContext)) {
    return { isValid: false, reason: "mentions_unavailable_size" };
  }

  if (
    hasAny(trimmedReply, ["توصيل مجاني", "livraison gratuite", "free delivery"]) &&
    !hasDeliveryFreeFact(productContext)
  ) {
    return { isValid: false, reason: "unsupported_free_delivery" };
  }

  if (
    hasAny(trimmedReply, ["تخفيض", "خصم", "discount", "promo"]) &&
    !hasDiscountFact(productContext)
  ) {
    return { isValid: false, reason: "unsupported_discount" };
  }

  if (
    hasAny(trimmedReply, ["آراء الزبناء", "اراء الزبناء", "تقييمات", "reviews", "avis"]) &&
    !hasReviewFact(productContext)
  ) {
    return { isValid: false, reason: "unsupported_reviews" };
  }

  if (
    hasAny(trimmedReply, ["المحل", "العنوان", "adresse", "store"]) &&
    hasAny(trimmedReply, ["كاين", "موجود", "ف ", "في "]) &&
    !hasStoreAddress(productContext) &&
    !hasAny(trimmedReply, ["ما متوفرش", "ما عنديش", "نقدر نأكدو"])
  ) {
    return { isValid: false, reason: "unsupported_store_address" };
  }

  if (
    hasAny(trimmedReply, ["واتساب", "رقم الهاتف", "اتصل", "call", "phone"]) &&
    !hasAny(trimmedReply, ["صيفط", "رسالة"])
  ) {
    return { isValid: false, reason: "unsupported_contact_claim" };
  }

  return { isValid: true };
}
