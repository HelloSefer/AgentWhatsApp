import type {
  OfferConfigIssue,
  ProductOfferConfig,
  ProductOfferConfigValidationResult,
} from "./offer.types";
import {
  MAX_PRODUCT_OFFER_ID_LENGTH,
  MAX_PRODUCT_OFFER_LABEL_LENGTH,
  MAX_PRODUCT_OFFER_PRIORITY,
  MAX_PRODUCT_OFFER_REQUIRED_ITEM_COUNT,
} from "./offer.types";

type ProductOfferValidationInput = {
  productId: unknown;
  currency: unknown;
  offers?: unknown;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/.test(value);
}

function addError(
  errors: OfferConfigIssue[],
  path: string,
  code: OfferConfigIssue["code"],
  message: string,
) {
  errors.push({ path, code, message });
}

function normalizeCurrency(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function hasMoneyPrecision(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON;
}

function parseAvailabilityDate(
  value: unknown,
  path: string,
  code: "INVALID_STARTS_AT" | "INVALID_ENDS_AT",
  errors: OfferConfigIssue[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const text = cleanText(value);
  const timestamp = Date.parse(text);

  if (!text || Number.isNaN(timestamp)) {
    addError(errors, path, code, `${path} must be a valid date-time string.`);
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

function compareOffers(left: ProductOfferConfig, right: ProductOfferConfig): number {
  const priorityDifference = (left.priority ?? 0) - (right.priority ?? 0);

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const countDifference = left.requiredItemCount - right.requiredItemCount;

  if (countDifference !== 0) {
    return countDifference;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Validation is deliberately side-effect free: normal invalid seller config
 * returns typed errors and never mutates the supplied product configuration.
 */
export function validateAndNormalizeProductOffers(
  input: ProductOfferValidationInput,
): ProductOfferConfigValidationResult {
  const errors: OfferConfigIssue[] = [];
  const warnings: OfferConfigIssue[] = [];
  const productId = cleanText(input.productId);
  const productCurrency = normalizeCurrency(input.currency);

  if (!productId) {
    addError(errors, "productId", "INVALID_PRODUCT_ID", "productId is required.");
  }

  if (!/^[A-Z]{3}$/.test(productCurrency)) {
    addError(errors, "currency", "INVALID_CURRENCY", "currency must be a configured three-letter code.");
  }

  if (input.offers === undefined) {
    return {
      valid: errors.length === 0,
      normalizedOffers: [],
      errors,
      warnings,
    };
  }

  if (!Array.isArray(input.offers)) {
    addError(errors, "offers", "INVALID_OFFER", "offers must be an array when configured.");
    return { valid: false, normalizedOffers: [], errors, warnings };
  }

  const normalizedOffers: ProductOfferConfig[] = [];
  const seenIds = new Set<string>();

  input.offers.forEach((candidate, index) => {
    const path = `offers[${index}]`;

    if (!isRecord(candidate)) {
      addError(errors, path, "INVALID_OFFER", `${path} must be an object.`);
      return;
    }

    const id = cleanText(candidate.id);
    const offerProductId = cleanText(candidate.productId);
    const label = cleanText(candidate.label);
    const requiredItemCount = candidate.requiredItemCount;
    const totalPrice = candidate.totalPrice;
    const currency = normalizeCurrency(candidate.currency);
    const active = candidate.active;
    const allowMixedOptions = candidate.allowMixedOptions;
    const priority = candidate.priority;
    const startsAt = parseAvailabilityDate(
      candidate.startsAt,
      `${path}.startsAt`,
      "INVALID_STARTS_AT",
      errors,
    );
    const endsAt = parseAvailabilityDate(
      candidate.endsAt,
      `${path}.endsAt`,
      "INVALID_ENDS_AT",
      errors,
    );
    const beforeErrors = errors.length;

    if (!id) {
      addError(errors, `${path}.id`, "EMPTY_ID", `${path}.id is required.`);
    } else if (id.length > MAX_PRODUCT_OFFER_ID_LENGTH || hasControlCharacters(id)) {
      addError(errors, `${path}.id`, "INVALID_ID", `${path}.id is invalid.`);
    } else if (seenIds.has(id)) {
      addError(errors, `${path}.id`, "DUPLICATE_ID", `${path}.id duplicates another offer id.`);
    } else {
      seenIds.add(id);
    }

    if (offerProductId !== productId) {
      addError(errors, `${path}.productId`, "PRODUCT_ID_MISMATCH", `${path}.productId must match productId.`);
    }

    if (!label) {
      addError(errors, `${path}.label`, "EMPTY_LABEL", `${path}.label is required.`);
    } else if (label.length > MAX_PRODUCT_OFFER_LABEL_LENGTH || hasControlCharacters(label)) {
      addError(errors, `${path}.label`, "INVALID_LABEL", `${path}.label is invalid.`);
    }

    if (
      typeof requiredItemCount !== "number" ||
      !Number.isSafeInteger(requiredItemCount) ||
      requiredItemCount <= 0 ||
      requiredItemCount > MAX_PRODUCT_OFFER_REQUIRED_ITEM_COUNT
    ) {
      addError(errors, `${path}.requiredItemCount`, "INVALID_REQUIRED_ITEM_COUNT", `${path}.requiredItemCount must be a safe positive integer within the configured maximum.`);
    }

    if (
      typeof totalPrice !== "number" ||
      !Number.isFinite(totalPrice) ||
      totalPrice <= 0 ||
      !hasMoneyPrecision(totalPrice)
    ) {
      addError(errors, `${path}.totalPrice`, "INVALID_TOTAL_PRICE", `${path}.totalPrice must be a positive finite amount with at most two decimal places.`);
    }

    if (!/^[A-Z]{3}$/.test(currency) || currency !== productCurrency) {
      addError(errors, `${path}.currency`, "INVALID_CURRENCY", `${path}.currency must match the product currency.`);
    }

    if (typeof active !== "boolean") {
      addError(errors, `${path}.active`, "INVALID_ACTIVE", `${path}.active must be a boolean.`);
    }

    if (typeof allowMixedOptions !== "boolean") {
      addError(errors, `${path}.allowMixedOptions`, "INVALID_ALLOW_MIXED_OPTIONS", `${path}.allowMixedOptions must be a boolean.`);
    }

    if (
      priority !== undefined &&
      (typeof priority !== "number" ||
        !Number.isSafeInteger(priority) ||
        Math.abs(priority) > MAX_PRODUCT_OFFER_PRIORITY)
    ) {
      addError(errors, `${path}.priority`, "INVALID_PRIORITY", `${path}.priority must be a safe integer within the configured range.`);
    }

    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
      addError(errors, path, "INVALID_AVAILABILITY_WINDOW", `${path}.startsAt must be before ${path}.endsAt.`);
    }

    if (errors.length !== beforeErrors) {
      return;
    }

    normalizedOffers.push({
      id,
      productId: offerProductId,
      label,
      requiredItemCount: requiredItemCount as number,
      totalPrice: totalPrice as number,
      currency,
      active: active as boolean,
      allowMixedOptions: allowMixedOptions as boolean,
      ...(priority === undefined ? {} : { priority: priority as number }),
      ...(startsAt === undefined ? {} : { startsAt }),
      ...(endsAt === undefined ? {} : { endsAt }),
    });
  });

  if (errors.length > 0) {
    return { valid: false, normalizedOffers: [], errors, warnings };
  }

  return {
    valid: true,
    normalizedOffers: [...normalizedOffers].sort(compareOffers),
    errors,
    warnings,
  };
}
