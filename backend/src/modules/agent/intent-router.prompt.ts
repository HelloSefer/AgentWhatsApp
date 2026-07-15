import type {
  AgentIntent,
  CustomerLanguage,
  CustomerMood,
} from "./agent-brain.types";
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

function compactList(items?: string[]): string {
  return items?.filter(Boolean).join(", ") || "";
}

function buildProductContextSummary(productContext: ProductContext): string {
  const summary: Record<string, unknown> = {
    businessName: productContext.businessName,
    productName: productContext.productName,
    category: productContext.category,
    price: productContext.price,
    currency: productContext.currency,
    colors: productContext.availableColors,
    sizes: productContext.availableSizes,
    variants: productContext.variants,
    features: productContext.features,
    deliveryInfo: productContext.deliveryInfo,
    deliveryAreas: compactList(productContext.deliveryAreas),
    deliveryTime: productContext.deliveryTime,
    paymentMethods: productContext.paymentMethods,
    offer: productContext.offer,
    attributes: productContext.attributes,
  };

  return JSON.stringify(summary);
}

export function buildIntentRouterPrompt(
  message: string,
  productContext: ProductContext,
): string {
  return `
You are an AI intent router for a Moroccan WhatsApp sales agent.
Return JSON only. No markdown. No explanation. Do not generate a customer reply.

Analyze Moroccan Darija, Arabizi, Arabic, French, English, and mixed messages.
This is an informational fallback only. Never extract or classify order fields, corrections, confirmation, cancellation, or order lifecycle actions.
Flexible Arabizi examples:
- "xno katbi3o" => product_identity
- "ghali shwiya" => price_objection
- "sift lia tsawr" => image_request
- "wach kayn livraison" => delivery_payment_question
- "salam" => greeting

Priority rules:
- If customer asks to speak to a person, intent must be human_handoff_request and needsHuman must be true.
- If customer asks what you sell or what is available, intent must be product_identity.
- If customer asks for pictures, intent must be image_request.
- If customer only asks about size availability, intent must be size_question.

More examples:
- "xno katbi3o" => {"intent":"product_identity","language":"darija_arabizi","mood":"neutral","entities":{},"missingOrderFields":[],"needsHuman":false}
- "بغيت نهضر مع شي واحد" => {"intent":"human_handoff_request","language":"darija_arabic","mood":"confused","entities":{},"missingOrderFields":[],"needsHuman":true}

Allowed intents: ${allowedIntents.join(", ")}
Allowed languages: ${allowedLanguages.join(", ")}
Allowed moods: ${allowedMoods.join(", ")}

Return an empty entities object and an empty missingOrderFields array. Deterministic services own all order-field parsing.

Extract product question info if present:
requestedAttribute, requestedColor, requestedSize, requestedVariant.

needsHuman is true only for complaints, angry messages, explicit human request, or unclear repeated issue.
If unsure, use intent "unknown" and low confidence.
reasoningNote must be a short safe diagnostic only, never chain-of-thought.

Product context:
${buildProductContextSummary(productContext)}

Customer message:
${JSON.stringify(message)}

Output exactly this JSON shape:
{"intent":"unknown","confidence":0,"language":"unknown","mood":"unknown","entities":{},"productQuestion":{},"missingOrderFields":[],"needsHuman":false,"reasoningNote":"Short diagnostic."}
`.trim();
}
