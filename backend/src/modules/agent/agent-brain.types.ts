import type { AgentAction } from "./agent-action.types";

export type AgentIntent =
  | "greeting"
  | "product_identity"
  | "price_question"
  | "delivery_payment_question"
  | "color_question"
  | "size_question"
  | "image_request"
  | "recommendation_request"
  | "product_attribute_question"
  | "order_intent"
  | "order_info_provided"
  | "order_confirmation"
  | "price_objection"
  | "not_interested"
  | "complaint"
  | "off_topic"
  | "human_handoff_request"
  | "unknown";

export type CustomerLanguage =
  | "darija_arabic"
  | "darija_arabizi"
  | "arabic"
  | "french"
  | "english"
  | "mixed"
  | "unknown";

export type CustomerMood =
  | "interested"
  | "hesitant"
  | "confused"
  | "price_sensitive"
  | "angry"
  | "neutral"
  | "unknown";

export interface OrderEntities {
  fullName?: string;
  phone?: string;
  city?: string;
  address?: string;
  productName?: string;
  variant?: string;
  color?: string;
  size?: string;
  quantity?: number;
  notes?: string;
}

export interface ProductQuestionEntities {
  requestedAttribute?: string;
  requestedColor?: string;
  requestedSize?: string;
  requestedVariant?: string;
}

export interface AgentBrainAnalysis {
  intent: AgentIntent;
  confidence: number;
  language: CustomerLanguage;
  mood: CustomerMood;
  entities: OrderEntities;
  productQuestion?: ProductQuestionEntities;
  missingOrderFields: string[];
  needsHuman: boolean;
  reasoningNote?: string;
}

export interface ConversationMessage {
  role: "customer" | "agent" | "system";
  text: string;
  timestamp: string;
}

export interface ConversationOrderState {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  awaitingConfirmation: boolean;
  confirmed: boolean;
  lastUpdatedAt: string;
}

export interface ConversationSession {
  sessionId: string;
  customerId: string;
  customerPhone?: string;
  conversationKey?: string;
  sellerId?: string;
  productId?: string;
  messages: ConversationMessage[];
  orderState: ConversationOrderState;
  lastIntent?: AgentIntent;
  lastMood?: CustomerMood;
  sellerBrain?: {
    recentReplyKeys: string[];
    lastIntent?: string;
    lastReplyAt?: string;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface AgentBrainResult {
  reply: string;
  analysis: AgentBrainAnalysis;
  session?: ConversationSession;
  actions: AgentAction[];
  source: "direct" | "ai_router" | "ai_fallback";
}

export const DEFAULT_REQUIRED_ORDER_FIELDS = [
  "fullName",
  "phone",
  "city",
  "address",
];
