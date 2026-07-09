import type { FirstEntryCtaId } from "./first-entry-renderer.service";
import type { FirstEntryRecommendedNextStep } from "./first-entry-intent-preview.service";

export type FirstEntryClickIntent = "order" | "info" | "unknown";

export type FirstEntryClickConfidence = "high" | "medium" | "low";

export interface FirstEntryClickNormalizationResult {
  previewOnly: true;
  recognized: boolean;
  rawInput: string;
  normalizedId?: FirstEntryCtaId;
  intent: FirstEntryClickIntent;
  recommendedNextStep:
    | Extract<
        FirstEntryRecommendedNextStep,
        "handoff_order_path_preview" | "handoff_info_path_preview"
      >
    | "unknown_click_preview";
  label?: string;
  confidence: FirstEntryClickConfidence;
  warnings?: string[];
}

const orderClickId: FirstEntryCtaId = "first_entry:order_now";
const infoClickId: FirstEntryCtaId = "first_entry:more_info";

const orderLabels = [
  "أطلب الآن",
  "اطلب الآن",
  "نعم أطلب",
  "كمّل الطلب",
  "كمل الطلب",
  "order",
  "commande",
];

const infoLabels = [
  "المزيد من المعلومات",
  "معلومات أكثر",
  "معلومات اكثر",
  "شوف التفاصيل",
  "details",
  "info",
  "more info",
];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeComparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[؟?!.،,؛:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOrderResult(input: {
  rawInput: string;
  confidence: FirstEntryClickConfidence;
  label?: string;
}): FirstEntryClickNormalizationResult {
  return {
    previewOnly: true,
    recognized: true,
    rawInput: input.rawInput,
    normalizedId: orderClickId,
    intent: "order",
    recommendedNextStep: "handoff_order_path_preview",
    label: input.label,
    confidence: input.confidence,
  };
}

function buildInfoResult(input: {
  rawInput: string;
  confidence: FirstEntryClickConfidence;
  label?: string;
}): FirstEntryClickNormalizationResult {
  return {
    previewOnly: true,
    recognized: true,
    rawInput: input.rawInput,
    normalizedId: infoClickId,
    intent: "info",
    recommendedNextStep: "handoff_info_path_preview",
    label: input.label,
    confidence: input.confidence,
  };
}

function buildUnknownResult(rawInput: string): FirstEntryClickNormalizationResult {
  return {
    previewOnly: true,
    recognized: false,
    rawInput,
    intent: "unknown",
    recommendedNextStep: "unknown_click_preview",
    confidence: "low",
    warnings: ["unknown_first_entry_click"],
  };
}

export function normalizeFirstEntryClick(
  value: unknown,
): FirstEntryClickNormalizationResult {
  const rawInput = cleanString(value);

  if (!rawInput) {
    return buildUnknownResult("");
  }

  if (rawInput === orderClickId) {
    return buildOrderResult({
      rawInput,
      confidence: "high",
      label: "أطلب الآن",
    });
  }

  if (rawInput === infoClickId) {
    return buildInfoResult({
      rawInput,
      confidence: "high",
      label: "المزيد من المعلومات",
    });
  }

  const normalized = normalizeComparable(rawInput);

  if (orderLabels.some((label) => normalizeComparable(label) === normalized)) {
    return buildOrderResult({
      rawInput,
      confidence: "medium",
      label: rawInput,
    });
  }

  if (infoLabels.some((label) => normalizeComparable(label) === normalized)) {
    return buildInfoResult({
      rawInput,
      confidence: "medium",
      label: rawInput,
    });
  }

  return buildUnknownResult(rawInput);
}
