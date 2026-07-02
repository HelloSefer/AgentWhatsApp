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
    requiredOrderFields: productContext.requiredOrderFields,
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
Flexible Arabizi examples:
- "xno katbi3o" => product_identity
- "bghit ncommandi" => order_intent
- "bghit wa7da k7la size 38" => order_intent with color black and size 38
- "bghit wa7da k7la size 38 ana f casa" => order_intent with quantity 1, color black, size 38, city casa
- "ghali shwiya" => price_objection
- "sift lia tsawr" => image_request
- "wach kayn livraison" => delivery_payment_question
- "salam" => greeting

Priority rules:
- If customer says they want to buy/order and provides any product choices or details, intent must be order_intent, not size_question or color_question.
- If message looks like customer details with phone, city, or address, intent must be order_info_provided.
- If customer asks to speak to a person, intent must be human_handoff_request and needsHuman must be true.
- If customer asks what you sell or what is available, intent must be product_identity.
- If customer asks for pictures, intent must be image_request.
- If customer only asks about size availability, intent must be size_question.

More examples:
- "xno katbi3o" => {"intent":"product_identity","language":"darija_arabizi","mood":"neutral","entities":{},"missingOrderFields":[],"needsHuman":false}
- "bghit wa7da k7la size 38 ana f casa" => {"intent":"order_intent","language":"darija_arabizi","mood":"interested","entities":{"quantity":1,"color":"أسود","size":"38","city":"كازا"},"missingOrderFields":[],"needsHuman":false}
- "محمد 0612345678 كازا حي السلام" => {"intent":"order_info_provided","language":"darija_arabic","mood":"interested","entities":{"fullName":"محمد","phone":"0612345678","city":"كازا","address":"حي السلام"},"missingOrderFields":[],"needsHuman":false}
- "بغيت نهضر مع شي واحد" => {"intent":"human_handoff_request","language":"darija_arabic","mood":"confused","entities":{},"missingOrderFields":[],"needsHuman":true}

Allowed intents: ${allowedIntents.join(", ")}
Allowed languages: ${allowedLanguages.join(", ")}
Allowed moods: ${allowedMoods.join(", ")}

Extract order entities if present:
fullName, phone, city, address, productName, variant, color, size, quantity, notes.

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
