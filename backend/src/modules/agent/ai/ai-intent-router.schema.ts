import { z } from "zod";

export const aiIntentRouterIntentValues = [
  "greeting",
  "price_question",
  "size_question",
  "color_question",
  "delivery_question",
  "payment_question",
  "image_request",
  "product_info_question",
  "order_start",
  "order_followup",
  "order_confirmation",
  "order_correction",
  "objection_price",
  "objection_delivery",
  "objection_trust",
  "negotiation",
  "complaint",
  "unrelated",
  "unknown",
] as const;

export const aiIntentRouterLanguageValues = [
  "darija",
  "arabic",
  "arabizi",
  "french",
  "english",
  "mixed",
  "unknown",
] as const;

export const aiIntentRouterCustomerMoodValues = [
  "interested",
  "ready_to_order",
  "hesitant",
  "confused",
  "price_sensitive",
  "angry",
  "neutral",
] as const;

export const aiIntentRouterSalesStageValues = [
  "new_lead",
  "asking_info",
  "comparing",
  "ready_to_order",
  "giving_order_info",
  "awaiting_confirmation",
  "confirmed",
  "not_relevant",
] as const;

export const aiIntentRouterEntitiesSchema = z.object({
  size: z.string().nullable(),
  color: z.string().nullable(),
  city: z.string().nullable(),
  quantity: z.number().nullable(),
  phone: z.string().nullable(),
  fullName: z.string().nullable(),
  address: z.string().nullable(),
});

export const aiIntentRouterAnalysisSchema = z.object({
  intent: z.enum(aiIntentRouterIntentValues),
  subIntent: z.string().nullable(),
  entities: aiIntentRouterEntitiesSchema,
  language: z.enum(aiIntentRouterLanguageValues),
  customerMood: z.enum(aiIntentRouterCustomerMoodValues),
  salesStage: z.enum(aiIntentRouterSalesStageValues),
  salesOpportunity: z.boolean(),
  shouldUseDirectAnswer: z.boolean(),
  shouldContinueOrderFlow: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type ValidatedAIIntentRouterAnalysis = z.infer<
  typeof aiIntentRouterAnalysisSchema
>;

export const safeFallbackIntentAnalysis: ValidatedAIIntentRouterAnalysis = {
  intent: "unknown",
  subIntent: null,
  entities: {
    size: null,
    color: null,
    city: null,
    quantity: null,
    phone: null,
    fullName: null,
    address: null,
  },
  language: "unknown",
  customerMood: "neutral",
  salesStage: "not_relevant",
  salesOpportunity: false,
  shouldUseDirectAnswer: false,
  shouldContinueOrderFlow: false,
  confidence: 0,
};

export function validateAIIntentRouterAnalysis(value: unknown): {
  analysis: ValidatedAIIntentRouterAnalysis;
  validationFailed: boolean;
} {
  const validationResult = aiIntentRouterAnalysisSchema.safeParse(value);

  if (!validationResult.success) {
    return {
      analysis: safeFallbackIntentAnalysis,
      validationFailed: true,
    };
  }

  return {
    analysis: validationResult.data,
    validationFailed: false,
  };
}
