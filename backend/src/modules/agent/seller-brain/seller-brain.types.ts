import type { AIIntentRouterAnalysis } from "../ai/ai-intent-router.service";
import type { ConversationOrderState } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";

export type SellerBrainReplyGoal =
  | "answer_fact"
  | "reassure"
  | "handle_price_objection"
  | "recommend"
  | "guide_to_order"
  | "clarify"
  | "acknowledge";

export type SellerBrainNextStep =
  | "ask_color"
  | "ask_size"
  | "ask_order"
  | "ask_preference"
  | "offer_help"
  | "none";

export type SellerBrainTone =
  | "friendly"
  | "reassuring"
  | "confident"
  | "concise"
  | "consultative";

export interface SellerBrainInput {
  message: string;
  customerId?: string;
  intentAnalysis: AIIntentRouterAnalysis;
  productContext: ProductContext;
  orderState?: ConversationOrderState;
  recentReplyKeys?: string[];
}

export interface SellerBrainPlan {
  intent: string;
  subIntent: string | null;
  mood: string;
  stage: string;
  replyGoal: SellerBrainReplyGoal;
  factsToMention: string[];
  forbiddenClaims: string[];
  nextStep: SellerBrainNextStep;
  tone: SellerBrainTone;
}

export interface SellerBrainResult {
  reply: string;
  replyKey: string;
  plan: SellerBrainPlan;
  source: "seller_brain";
}

export interface SellerBrainEvalCase {
  message: string;
  customerId?: string;
}

export interface SellerBrainEvalResult {
  message: string;
  intent: string;
  reply: string;
  replyKey: string;
  source: "seller_brain";
  durationMs: number;
  genericFallback: boolean;
  repeatedReply: boolean;
  unsafeClaim: boolean;
}
