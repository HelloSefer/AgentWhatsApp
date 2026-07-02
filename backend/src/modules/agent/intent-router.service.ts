import { generateStructuredAIReply } from "../ai/ai.service";
import type {
  AgentBrainAnalysis,
  AgentIntent,
  CustomerLanguage,
  CustomerMood,
  OrderEntities,
  ProductQuestionEntities,
} from "./agent-brain.types";
import { DEFAULT_PRODUCT_CONTEXT } from "./default-product-context";
import { fastAnalyzeCustomerMessage } from "./fast-intent-analyzer.service";
import { buildIntentRouterPrompt } from "./intent-router.prompt";
import type { ProductContext } from "./product-context.types";

const allowedIntents: AgentIntent[] = [
  "greeting",
  "product_identity",
  "price_question",
  "delivery_payment_question",
  "color_question",
  "size_question",
  "image_request",
  "recommendation_request",
  "product_attribute_question",
  "order_intent",
  "order_info_provided",
  "order_confirmation",
  "price_objection",
  "not_interested",
  "complaint",
  "off_topic",
  "human_handoff_request",
  "unknown",
];

const allowedLanguages: CustomerLanguage[] = [
  "darija_arabic",
  "darija_arabizi",
  "arabic",
  "french",
  "english",
  "mixed",
  "unknown",
];

const allowedMoods: CustomerMood[] = [
  "interested",
  "hesitant",
  "confused",
  "price_sensitive",
  "angry",
  "neutral",
  "unknown",
];

const fallbackAnalysis: AgentBrainAnalysis = {
  intent: "unknown",
  confidence: 0,
  language: "unknown",
  mood: "unknown",
  entities: {},
  missingOrderFields: [],
  needsHuman: false,
  reasoningNote: "Failed to parse AI router output.",
};

const agentBrainAnalysisSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: allowedIntents,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    language: {
      type: "string",
      enum: allowedLanguages,
    },
    mood: {
      type: "string",
      enum: allowedMoods,
    },
    entities: {
      type: "object",
      properties: {
        fullName: { type: "string" },
        phone: { type: "string" },
        city: { type: "string" },
        address: { type: "string" },
        productName: { type: "string" },
        variant: { type: "string" },
        color: { type: "string" },
        size: { type: "string" },
        quantity: { type: "number" },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
    productQuestion: {
      type: "object",
      properties: {
        requestedAttribute: { type: "string" },
        requestedColor: { type: "string" },
        requestedSize: { type: "string" },
        requestedVariant: { type: "string" },
      },
      additionalProperties: false,
    },
    missingOrderFields: {
      type: "array",
      items: { type: "string" },
    },
    needsHuman: {
      type: "boolean",
    },
    reasoningNote: {
      type: "string",
    },
  },
  required: [
    "intent",
    "confidence",
    "language",
    "mood",
    "entities",
    "missingOrderFields",
    "needsHuman",
  ],
  additionalProperties: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampConfidence(value: unknown): number {
  const confidence = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(confidence)) {
    return 0;
  }

  return Math.max(0, Math.min(1, confidence));
}

function sanitizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowedValues.includes(value as T)
    ? (value as T)
    : fallback;
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed || undefined;
}

function sanitizeOrderEntities(value: unknown): OrderEntities {
  if (!isObject(value)) {
    return {};
  }

  const quantity =
    typeof value.quantity === "number"
      ? value.quantity
      : Number(value.quantity);

  return {
    fullName: sanitizeString(value.fullName),
    phone: sanitizeString(value.phone),
    city: sanitizeString(value.city),
    address: sanitizeString(value.address),
    productName: sanitizeString(value.productName),
    variant: sanitizeString(value.variant),
    color: sanitizeString(value.color),
    size: sanitizeString(value.size),
    quantity: Number.isFinite(quantity) ? quantity : undefined,
    notes: sanitizeString(value.notes),
  };
}

function sanitizeProductQuestion(value: unknown): ProductQuestionEntities | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const productQuestion: ProductQuestionEntities = {
    requestedAttribute: sanitizeString(value.requestedAttribute),
    requestedColor: sanitizeString(value.requestedColor),
    requestedSize: sanitizeString(value.requestedSize),
    requestedVariant: sanitizeString(value.requestedVariant),
  };

  return Object.values(productQuestion).some(Boolean)
    ? productQuestion
    : undefined;
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => sanitizeString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function extractFirstJsonObject(text: string): string | null {
  const startIndex = text.indexOf("{");

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (character === "\\") {
      isEscaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseRouterJson(text: string): unknown {
  const jsonText = extractFirstJsonObject(text);

  if (!jsonText) {
    throw new Error("No JSON object found");
  }

  return JSON.parse(jsonText);
}

function sanitizeAnalysis(value: unknown): AgentBrainAnalysis {
  if (!isObject(value)) {
    return fallbackAnalysis;
  }

  return {
    intent: sanitizeEnum(value.intent, allowedIntents, "unknown"),
    confidence: clampConfidence(value.confidence),
    language: sanitizeEnum(value.language, allowedLanguages, "unknown"),
    mood: sanitizeEnum(value.mood, allowedMoods, "unknown"),
    entities: sanitizeOrderEntities(value.entities),
    productQuestion: sanitizeProductQuestion(value.productQuestion),
    missingOrderFields: sanitizeStringArray(value.missingOrderFields),
    needsHuman: typeof value.needsHuman === "boolean" ? value.needsHuman : false,
    reasoningNote: sanitizeString(value.reasoningNote)?.slice(0, 180),
  };
}

export async function analyzeCustomerMessage(
  message: string,
  productContext: ProductContext = DEFAULT_PRODUCT_CONTEXT,
): Promise<AgentBrainAnalysis> {
  const userMessage = message.trim();

  if (!userMessage) {
    throw new Error("Message is required");
  }

  const fastAnalysis = fastAnalyzeCustomerMessage(userMessage);

  if (fastAnalysis) {
    return fastAnalysis;
  }

  try {
    const prompt = buildIntentRouterPrompt(userMessage, productContext);
    const aiReply = await generateStructuredAIReply(
      prompt,
      agentBrainAnalysisSchema,
    );
    const parsed = parseRouterJson(aiReply);
    const sanitizedAnalysis = sanitizeAnalysis(parsed);
    const correctedAnalysis = fastAnalyzeCustomerMessage(userMessage);

    return correctedAnalysis || sanitizedAnalysis;
  } catch (_error) {
    return fallbackAnalysis;
  }
}
