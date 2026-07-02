import type { ProductContext } from "../product-context.types";
import { colorDefinitions } from "./attribute-definitions";
import {
  formatNaturalList,
  normalizeComparable,
} from "./text-normalization";

export function formatPriceText(productContext: ProductContext): string {
  if (!productContext.price) {
    return "";
  }

  return [productContext.price, productContext.currency].filter(Boolean).join(" ");
}

export function formatColorName(color: string): string {
  const normalized = normalizeComparable(color);
  const knownColor = colorDefinitions.find((definition) =>
    definition.values.some((value) => normalizeComparable(value) === normalized),
  );

  return knownColor?.replyName || color;
}

export function formatColorList(colors: string[]): string {
  return formatNaturalList(colors.map((color) => formatColorName(color)));
}

export function formatSizesSummary(sizes: string[]): string {
  const cleanSizes = sizes.map((size) => size.trim()).filter(Boolean);
  const numericSizes = cleanSizes
    .map((size) => Number(size))
    .filter((size) => Number.isInteger(size));

  if (numericSizes.length === cleanSizes.length && numericSizes.length >= 3) {
    const sortedSizes = [...numericSizes].sort((a, b) => a - b);
    const isConsecutive = sortedSizes.every(
      (size, index) => index === 0 || size === sortedSizes[index - 1] + 1,
    );

    if (isConsecutive) {
      return `من ${sortedSizes[0]} حتى ${sortedSizes[sortedSizes.length - 1]}`;
    }
  }

  return formatNaturalList(cleanSizes);
}

export function getPaymentText(productContext: ProductContext): string {
  const methods = productContext.paymentMethods?.filter(Boolean) || [];

  if (!methods.length) {
    return "";
  }

  if (methods.some((method) => method.includes("عند الاستلام"))) {
    return "الدفع عند الاستلام";
  }

  return `الدفع متوفر ب ${formatNaturalList(methods)}`;
}

export function getDeliveryText(productContext: ProductContext): string {
  if (productContext.deliveryInfo) {
    return productContext.deliveryInfo;
  }

  const areas = productContext.deliveryAreas?.filter(Boolean) || [];

  if (!areas.length) {
    return "";
  }

  const areaText = formatNaturalList(areas);

  return areaText.includes("جميع")
    ? `التوصيل متوفر ل${areaText}`
    : `التوصيل متوفر ل ${areaText}`;
}
