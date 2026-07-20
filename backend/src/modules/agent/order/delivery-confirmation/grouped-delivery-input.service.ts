import { getEffectiveCaptureMode, normalizeUnderstandingText } from "../../order-understanding/contextual-field-validator.service";
import type { ProductContext } from "../../config/product-context.types";
import { normalizeDeliveryFieldValue } from "./delivery-field-normalizer.service";
import type { DeliveryRequirement } from "./delivery-confirmation.types";

type StandardDeliveryField = "fullName" | "phone" | "city";

export type GroupedDeliveryParseResult = {
  values: ReadonlyMap<string, unknown>;
  invalidFieldKeys: readonly string[];
};

function normalized(value: string): string {
  return normalizeUnderstandingText(value).replace(/[\s_-]+/g, "");
}

function standardFieldFor(requirement: DeliveryRequirement): StandardDeliveryField | undefined {
  const key = normalized(requirement.key);
  const semantic = normalized(requirement.semanticType || "");
  const captureMode = getEffectiveCaptureMode(requirement.field);

  if (captureMode === "PHONE" || ["phone", "phonenumber", "telephone"].includes(semantic) || key === "phone") return "phone";
  if (captureMode === "LOCATION" || ["location", "locality", "city", "village", "commune", "neighborhood"].includes(semantic) || key === "city") return "city";
  if (key === "fullname" || ["personname", "fullname", "customername", "name"].includes(semantic)) return "fullName";
  return undefined;
}

function cleanCandidate(value: string): string {
  return value.replace(/^[\s,،;:：-]+|[\s,،;:：-]+$/gu, "").replace(/\s+/gu, " ").trim();
}

function phoneLikeMatch(value: string): RegExpMatchArray | undefined {
  return value.match(/(?:\+212|0)(?:[\s.-]*\d){8,10}/u) || undefined;
}

function labelsFor(kind: StandardDeliveryField): string[] {
  if (kind === "fullName") return ["الاسم الكامل", "الاسم", "السميه", "السمية", "full name", "name", "nom"];
  if (kind === "phone") return ["رقم الهاتف", "الهاتف", "التلفون", "phone", "telephone", "tel", "téléphone"];
  return ["المدينة", "المدينه", "city", "ville"];
}

function findLabelledValue(text: string, kind: StandardDeliveryField): string | undefined {
  const labels = labelsFor(kind).map((label) => label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|[\\n,،;])\\s*(?:${labels})\\s*[:：-]?\\s*([^\\n,،;]+)`, "iu");
  return cleanCandidate(text.match(pattern)?.[1] || "") || undefined;
}

function splitParts(text: string): string[] {
  return text
    .split(/[\n,،;]/u)
    .map(cleanCandidate)
    .filter(Boolean);
}

/**
 * Returns a grouped request only for a configured standard name/phone/city
 * triplet. It is intentionally not a checkout whitelist: validation remains
 * delegated to the existing contextual field validators.
 */
export function getInitialGroupedDeliveryRequirements(
  requirements: readonly DeliveryRequirement[],
  hasValue: (value: unknown) => boolean,
  orderFields: Readonly<Record<string, unknown>>,
): DeliveryRequirement[] {
  const byKind = new Map<StandardDeliveryField, DeliveryRequirement>();
  for (const requirement of requirements) {
    const kind = standardFieldFor(requirement);
    if (kind && !byKind.has(kind)) byKind.set(kind, requirement);
  }
  if (!byKind.has("fullName") || !byKind.has("phone") || !byKind.has("city")) return [];

  const ordered: StandardDeliveryField[] = ["fullName", "phone", "city"];
  const missing = ordered
    .map((kind) => byKind.get(kind)!)
    .filter((requirement) => !hasValue(orderFields[requirement.key]));
  return missing.length >= 2 ? missing : [];
}

export function getRemainingGroupedDeliveryRequirements(input: {
  requirements: readonly DeliveryRequirement[];
  groupedFieldKeys?: readonly string[];
  hasValue: (value: unknown) => boolean;
  orderFields: Readonly<Record<string, unknown>>;
}): DeliveryRequirement[] {
  const requested = new Set((input.groupedFieldKeys || []).map(normalized));
  if (!requested.size) return [];
  return input.requirements.filter((requirement) =>
    requested.has(normalized(requirement.key)) && !input.hasValue(input.orderFields[requirement.key]),
  );
}

/** Deterministic parser for a previously requested name/phone/city group. */
export function parseGroupedDeliveryInput(input: {
  rawText: string;
  requirements: readonly DeliveryRequirement[];
  productContext: ProductContext;
}): GroupedDeliveryParseResult {
  const rawText = input.rawText.trim();
  const byKind = new Map<StandardDeliveryField, DeliveryRequirement>();
  for (const requirement of input.requirements) {
    const kind = standardFieldFor(requirement);
    if (kind && !byKind.has(kind)) byKind.set(kind, requirement);
  }

  const candidates = new Map<StandardDeliveryField, string>();
  for (const kind of ["fullName", "phone", "city"] as const) {
    if (!byKind.has(kind)) continue;
    const labelled = findLabelledValue(rawText, kind);
    if (labelled) candidates.set(kind, labelled);
  }

  const phoneMatch = phoneLikeMatch(rawText);
  if (byKind.has("phone") && !candidates.has("phone") && phoneMatch?.[0]) candidates.set("phone", phoneMatch[0]);

  const parts = splitParts(rawText);
  const phonePartIndex = parts.findIndex((part) => Boolean(phoneLikeMatch(part)));
  if (phonePartIndex >= 0) {
    if (byKind.has("fullName") && !candidates.has("fullName")) {
      const before = cleanCandidate(parts.slice(0, phonePartIndex).join(" "));
      if (before) candidates.set("fullName", before);
    }
    if (byKind.has("city") && !candidates.has("city")) {
      const after = cleanCandidate(parts.slice(phonePartIndex + 1).join(" "));
      if (after) candidates.set("city", after);
    }
  } else if (phoneMatch) {
    const index = phoneMatch.index || 0;
    if (byKind.has("fullName") && !candidates.has("fullName")) {
      const before = cleanCandidate(rawText.slice(0, index));
      if (before) candidates.set("fullName", before);
    }
    if (byKind.has("city") && !candidates.has("city")) {
      const after = cleanCandidate(rawText.slice(index + phoneMatch[0].length));
      if (after) candidates.set("city", after);
    }
  } else if (parts.length >= 2) {
    // The requested group has a documented order: name, phone, city. Without
    // labels or a phone, only use explicit positional evidence and never swap.
    if (byKind.has("fullName") && !candidates.has("fullName")) candidates.set("fullName", parts[0]);
    if (byKind.has("city") && !candidates.has("city")) candidates.set("city", parts[parts.length - 1]);
    if (byKind.has("phone") && !candidates.has("phone") && parts.length >= 3) candidates.set("phone", parts[1]);
  } else if (parts.length === 1 && byKind.has("fullName") && !candidates.has("fullName")) {
    // A lone first reply is treated as the first explicitly requested value.
    // Do not infer a city from a lone open-text value, which could swap fields.
    candidates.set("fullName", parts[0]!);
  }

  const values = new Map<string, unknown>();
  const invalidFieldKeys: string[] = [];
  for (const [kind, requirement] of byKind) {
    const candidate = candidates.get(kind);
    if (!candidate) continue;
    const normalizedValue = normalizeDeliveryFieldValue({ requirement, rawValue: candidate, productContext: input.productContext });
    if (normalizedValue.valid) values.set(requirement.key, normalizedValue.value);
    else invalidFieldKeys.push(requirement.key);
  }
  return { values, invalidFieldKeys };
}
