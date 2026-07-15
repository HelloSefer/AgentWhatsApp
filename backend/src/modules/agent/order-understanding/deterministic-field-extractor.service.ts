import type { FieldCandidate, OrderUnderstandingContext } from "./order-understanding.types";
import {
  getEffectiveCaptureMode,
  normalizeUnderstandingText,
} from "./contextual-field-validator.service";
import { classifyOrderMessageDisposition, isSideQuestionDisposition } from "./message-disposition.service";

const quantityWords: Array<[string, number]> = [
  ["واحدة", 1], ["واحده", 1], ["واحداة", 1], ["وحدة", 1], ["واحد", 1], ["wa7da", 1], ["wahda", 1],
  ["جوج", 2], ["زوج", 2], ["jouj", 2], ["jooj", 2],
];

const correctionTerms = ["غلط", "الصحيح", "بدل", "نبدل", "صحح", "correct", "change"];

function hasTerm(message: string, terms: string[]): boolean {
  const normalized = normalizeUnderstandingText(message);
  return terms.some((term) => normalized.includes(normalizeUnderstandingText(term)));
}

function candidate(
  fieldKey: string,
  value: string | number,
  source: FieldCandidate["source"],
  operation: FieldCandidate["operation"] = "SET",
  confidence = source === "interactive" ? 1 : source === "deterministic_exact" ? 0.98 : 0.84,
): FieldCandidate {
  return { fieldKey, value, source, operation, confidence };
}

function extractPhone(message: string): string | undefined {
  return message.match(/(?:\+212|0)[67]\d{8}\b/)?.[0];
}

function extractQuantity(message: string): number | undefined {
  const normalized = normalizeUnderstandingText(message);
  const labeled = normalized.match(/(?:الكمية|quantity|qty|qte|عدد)\s*(?:هي|هو|:)?\s*(\d+)/);
  const standalone = normalized.match(/^(\d+)$/);
  const value = labeled?.[1] || standalone?.[1];

  if (value) {
    return Number(value);
  }

  const padded = ` ${normalized} `;
  return quantityWords.find(([word]) => {
    const normalizedWord = normalizeUnderstandingText(word);
    return normalized === normalizedWord || padded.includes(` ${normalizedWord} `) || padded.includes(` ل${normalizedWord} `);
  })?.[1];
}

function isPlausibleLocation(message: string): boolean {
  const trimmed = message.trim();
  const normalized = normalizeUnderstandingText(trimmed);

  return Boolean(
    trimmed.length >= 2 &&
    trimmed.length <= 90 &&
    !/[؟?]/.test(trimmed) &&
    !/^(نعم|لا|yes|no|ok|order:?confirm|طلب جديد)$/i.test(normalized) &&
    !/^(?:\+212|0)?[67]\d{8}$/.test(trimmed.replace(/[\s.-]/g, "")) &&
    !/^\d+$/.test(trimmed) &&
    /[\p{Script=Arabic}a-zA-ZÀ-ÿ]/u.test(trimmed) &&
    /^[\p{Script=Arabic}a-zA-ZÀ-ÿ\d\s'-]+$/u.test(trimmed),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFieldTerms(field: OrderUnderstandingContext["fields"][number]): string[] {
  return [field.key, field.label, ...(field.aliases || [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function extractLabeledFieldValue(
  message: string,
  field: OrderUnderstandingContext["fields"][number],
): string | undefined {
  for (const term of getFieldTerms(field)) {
    const termPattern = escapeRegex(term).replace(/\s+/g, "\\s+");
    const match = message.match(
      new RegExp(`(?:^|\\s)${termPattern}\\s*(?:هي|هو|:|=)?\\s*(.+)$`, "iu"),
    );
    const value = match?.[1]
      ?.replace(/^(?:الجديد(?:ة)?|الصحيح(?:ة)?|هي|هو)\s+/iu, "")
      .trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractNumericForField(
  message: string,
  field: OrderUnderstandingContext["fields"][number],
): number | undefined {
  const labeled = extractLabeledFieldValue(message, field);
  const rawValue = labeled || (/^\d+$/.test(message.trim()) ? message.trim() : undefined);
  const numeric = rawValue?.match(/\d+/)?.[0];

  if (numeric) {
    return Number(numeric);
  }

  return field.key === "quantity" ? extractQuantity(labeled || message) : undefined;
}

function extractNameBeforePhone(message: string, phone: string): string | undefined {
  const before = message
    .slice(0, message.indexOf(phone))
    .replace(/(?:و?رقمي|و?رقم(?:\s+الهاتف)?|و?الهاتف|phone|tel)\s*$/iu, "")
    .replace(/(?:سميتي|اسمي|الاسم(?:\s+الكامل)?|name|nom)\s*/iu, "")
    .trim();
  const value = before.split(/\s+/).slice(0, 3).join(" ");
  return value || undefined;
}

function extractLabeledName(message: string): string | undefined {
  const match = message.match(
    /(?:^|\s)(?:سميتي|اسمي|الاسم(?:\s+الكامل)?|name|nom)\s*(?:هو|هي|:)?\s*(.+?)(?=\s+(?:و?رقمي|و?رقم(?:\s+الهاتف)?|و?الهاتف|phone|tel|المدينة|city|ville|العنوان|address|adresse)\b|$)/iu,
  );

  return match?.[1]?.trim();
}

function extractAddressAfterPhone(message: string, phone: string): string | undefined {
  const after = message.slice(message.indexOf(phone) + phone.length).trim();
  if (!after || /[؟?]/.test(after) || /^(نعم|لا|yes|no)$/i.test(normalizeUnderstandingText(after))) {
    return undefined;
  }

  const address = after.replace(/^(?:العنوان|address|adresse)\s*:?\s*/i, "").trim();
  return address.length >= 4 ? address : undefined;
}

function extractCityAndAddressAfterPhone(message: string, phone: string): {
  city?: string;
  address?: string;
} {
  const after = message.slice(message.indexOf(phone) + phone.length).trim()
    .replace(/^(?:وانا|أنا|انا|في|ف)\s*/i, "")
    .trim();
  const marker = after.match(/(حي|شارع|زنقة|درب|رقم|route|rue|quartier)/i);

  if (!marker || marker.index === undefined) {
    return {
      city: isPlausibleLocation(after) ? after : undefined,
    };
  }

  const city = after.slice(0, marker.index).trim();
  const address = after.slice(marker.index).trim();

  return {
    city: isPlausibleLocation(city) ? city : undefined,
    address: address.length >= 4 ? address : undefined,
  };
}

function getConfiguredOption(message: string, field: OrderUnderstandingContext["fields"][number]): string | undefined {
  const normalized = normalizeUnderstandingText(message);
  const direct = message.match(new RegExp(`^${escapeRegex(field.key)}\\s*:\\s*(.+)$`, "i"))?.[1];
  const candidateText = direct || message;
  const comparable = normalizeUnderstandingText(candidateText).replace(/^ال/, "");
  const padded = ` ${normalized} `;

  return field.options?.find((option) => {
    const normalizedOption = normalizeUnderstandingText(option).replace(/^ال/, "");
    const aliases = field.aliases || [];
    return comparable === normalizedOption || aliases.some((alias) => comparable === normalizeUnderstandingText(alias).replace(/^ال/, "")) || padded.includes(` ${normalizedOption} `) || normalized === normalizedOption;
  });
}

export function isOrderSideQuestion(message: string): boolean {
  return isSideQuestionDisposition(classifyOrderMessageDisposition(message).disposition);
}

export function extractDeterministicFieldCandidates(
  context: OrderUnderstandingContext,
): FieldCandidate[] {
  const message = context.extractionMessage;
  if (!message) {
    return [];
  }

  const correction = hasTerm(message, correctionTerms);
  const candidates: FieldCandidate[] = [];

  for (const field of context.fields) {
    if (!field.enabled || field.requirement === "DISABLED") {
      continue;
    }

    const interactive = (
      message.match(new RegExp(`^${escapeRegex(field.key)}\\s*:\\s*(.+)$`, "i"))?.[1] ||
      message.match(new RegExp(`^field:${escapeRegex(field.key)}:(.+)$`, "i"))?.[1]
    )?.trim();
    if (interactive) {
      candidates.push(candidate(field.key, interactive, "interactive", correction ? "REPLACE" : "SET"));
      continue;
    }

    if (field.options?.length) {
      const option = getConfiguredOption(message, field);
      if (option) {
        const existing = (context.session.orderState.collected as Record<string, unknown>)[field.key];
        const exactSelection = normalizeUnderstandingText(message) === normalizeUnderstandingText(option);
        candidates.push(candidate(
          field.key,
          option,
          "deterministic_exact",
          correction || (exactSelection && existing !== undefined) ? "REPLACE" : "SET",
        ));
      }
    }
  }

  const phone = extractPhone(message);
  if (phone && context.fields.some((field) => field.key === "phone")) {
    candidates.push(candidate("phone", phone, "deterministic_exact", correction ? "REPLACE" : "SET"));
    const name = extractNameBeforePhone(message, phone);
    if (name && context.fields.some((field) => field.key === "fullName")) {
      candidates.push(candidate("fullName", name, "deterministic_contextual", correction ? "REPLACE" : "SET", 0.86));
    }
    const segmented = extractCityAndAddressAfterPhone(message, phone);
    if (segmented.city && context.fields.some((field) => field.key === "city")) {
      candidates.push(candidate("city", segmented.city, "deterministic_contextual", correction ? "REPLACE" : "SET", 0.9));
    }
    const address =
      segmented.address ||
      (context.awaitedField?.key === "address"
        ? extractAddressAfterPhone(message, phone)
        : undefined);
    if (address && context.fields.some((field) => field.key === "address")) {
      candidates.push(candidate("address", address, "deterministic_contextual", correction ? "REPLACE" : "SET", segmented.address ? 0.92 : 0.82));
    }
  }

  const labeledName = extractLabeledName(message);
  if (labeledName && context.fields.some((field) => field.key === "fullName")) {
    candidates.push(candidate("fullName", labeledName, "deterministic_contextual", correction ? "REPLACE" : "SET", 0.94));
  }

  const quantity = extractQuantity(message);
  const numericOnly = /^\d+$/.test(normalizeUnderstandingText(message));
  const quantityIsAwaited = context.awaitedField?.key === "quantity";
  if (
    quantity &&
    context.fields.some((field) => field.key === "quantity") &&
    (!numericOnly || quantityIsAwaited)
  ) {
    candidates.push(candidate("quantity", quantity, "deterministic_exact", correction ? "REPLACE" : "SET"));
  }

  const awaited = context.awaitedField;

  if (
    awaited &&
    getEffectiveCaptureMode(awaited) === "PHONE" &&
    phone &&
    !candidates.some((entry) => entry.fieldKey === awaited.key)
  ) {
    candidates.push(candidate(awaited.key, phone, "deterministic_exact", correction ? "REPLACE" : "SET"));
  }

  if (
    awaited &&
    getEffectiveCaptureMode(awaited) === "NUMERIC" &&
    !candidates.some((entry) => entry.fieldKey === awaited.key)
  ) {
    const numericValue = extractNumericForField(message, awaited);
    if (numericValue !== undefined) {
      candidates.push(candidate(awaited.key, numericValue, "deterministic_exact", correction ? "REPLACE" : "SET"));
    }
  }
  const labeledCity = message.match(/(?:المدينة|مدينه|city|ville)\s*(?:هي|هو|:)?\s*([^؟?!،,.;:]+)/i)?.[1]?.trim();
  if (labeledCity && isPlausibleLocation(labeledCity) && context.fields.some((field) => field.key === "city")) {
    candidates.push(candidate("city", labeledCity, "deterministic_contextual", correction ? "REPLACE" : "SET", 0.94));
  }

  const collected = context.session.orderState.collected as Record<string, unknown>;
  const canAcceptVoluntaryCity =
    context.fields.some((field) => field.key === "city" && field.enabled) &&
    !collected.city &&
    Boolean(collected.fullName && collected.phone && collected.address) &&
    !candidates.some((entry) => entry.fieldKey === "city") &&
    !candidates.some((entry) => entry.fieldKey === "phone" || entry.fieldKey === "quantity") &&
    !isOrderSideQuestion(message) &&
    isPlausibleLocation(message);

  if (canAcceptVoluntaryCity) {
    candidates.push(candidate("city", message.trim(), "deterministic_contextual", "SET", 0.86));
  }

  if (
    context.residualFieldHint === "city" &&
    isPlausibleLocation(message) &&
    context.fields.some((field) => field.key === "city")
  ) {
    candidates.push(candidate("city", message.trim(), "deterministic_contextual", "SET", 0.92));
  }

  const labeledAddress = message.match(/(?:العنوان|address|adresse)\s*(?:هو|هي|:)?\s*(.+)$/i)?.[1]?.trim();
  if (correction && labeledAddress && context.fields.some((field) => field.key === "address")) {
    candidates.push(candidate("address", labeledAddress, "deterministic_contextual", "REPLACE", 0.94));
  }

  const addressField = context.fields.find(
    (field) => (field.captureMode === "ADDRESS" || field.key === "address") && field.allowMultipleMessages,
  );
  const addressPart = message.match(/^(?:حي|شارع|زنقة|درب|رقم|route|rue|quartier).+/i)?.[0]?.trim();
  if (
    addressField &&
    (context.session.orderState.collected as Record<string, unknown>)[addressField.key] &&
    addressPart &&
    !correction &&
    !isOrderSideQuestion(message)
  ) {
    candidates.push(candidate(addressField.key, addressPart, "deterministic_contextual", "APPEND", 0.88));
  }

  if (awaited && (getEffectiveCaptureMode(awaited) === "LOCATION" || awaited.key === "city")) {
    const labeled = message.match(/^(?:المدينة|مدينه|city|ville)\s*(?:هي|هو|:)?\s*(.+)$/i)?.[1]?.trim();
    const location = labeled || message.trim().replace(/^(?:في|ف)\s+/i, "");
    if (isPlausibleLocation(location) && !isOrderSideQuestion(message)) {
      candidates.push(candidate(awaited.key, location, "deterministic_contextual", correction ? "REPLACE" : "SET", labeled ? 0.94 : 0.82));
    }
  }

  if (awaited && (getEffectiveCaptureMode(awaited) === "ADDRESS" || awaited.key === "address")) {
    const labeled = message.match(/^(?:العنوان|address|adresse)\s*:?\s*(.+)$/i)?.[1]?.trim();
    const value = labeled || message.trim();
    const looksLikeAddress = /^(حي|شارع|زنقة|درب|رقم|route|rue|quartier)\b/i.test(normalizeUnderstandingText(value)) || value.split(/\s+/).length >= 2;
    if (looksLikeAddress && !isOrderSideQuestion(message) && value.length >= 4) {
      const existing = (context.session.orderState.collected as Record<string, unknown>)[awaited.key];
      const operation = correction ? "REPLACE" : existing && awaited.allowMultipleMessages ? "APPEND" : "SET";
      candidates.push(candidate(awaited.key, value, "deterministic_contextual", operation, labeled ? 0.94 : 0.8));
    }
  }

  if (
    awaited &&
    (getEffectiveCaptureMode(awaited) === "OPEN_TEXT" || getEffectiveCaptureMode(awaited) === "CUSTOM") &&
    !candidates.some((entry) => entry.fieldKey === awaited.key) &&
    !(context.residualFieldHint === "city" && awaited.key !== "city") &&
    !isOrderSideQuestion(message) &&
    !extractQuantity(message)
  ) {
    const value = extractLabeledFieldValue(message, awaited) || message.trim();

    if (value.length >= 2 && value.length <= 500 && !/[؟?]/.test(value)) {
      candidates.push(
        candidate(
          awaited.key,
          value,
          "deterministic_contextual",
          correction ? "REPLACE" : "SET",
          0.8,
        ),
      );
    }
  }

  if (correction) {
    for (const field of context.fields) {
      const captureMode = getEffectiveCaptureMode(field);
      if (
        !field.enabled ||
        field.requirement === "DISABLED" ||
        candidates.some((entry) => entry.fieldKey === field.key) ||
        captureMode === "CONFIGURED_ENUM"
      ) {
        continue;
      }

      const labeledValue = extractLabeledFieldValue(message, field);
      if (!labeledValue) {
        continue;
      }

      if (captureMode === "PHONE") {
        const labeledPhone = extractPhone(labeledValue);
        if (labeledPhone) candidates.push(candidate(field.key, labeledPhone, "deterministic_exact", "REPLACE"));
        continue;
      }

      if (captureMode === "NUMERIC") {
        const numericValue = extractNumericForField(labeledValue, field);
        if (numericValue !== undefined) candidates.push(candidate(field.key, numericValue, "deterministic_exact", "REPLACE"));
        continue;
      }

      candidates.push(candidate(field.key, labeledValue, "deterministic_contextual", "REPLACE", 0.94));
    }
  }

  return candidates;
}
