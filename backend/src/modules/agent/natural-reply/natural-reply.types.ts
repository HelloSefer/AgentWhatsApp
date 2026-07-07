import type { AIIntentRouterAnalysis } from "../ai/ai-intent-router.service";
import type { ConversationOrderState } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";

export interface NaturalReplyMeta {
  naturalReplyUsed: boolean;
  naturalReplyTimedOut: boolean;
  naturalReplyValidationFailed: boolean;
  naturalReplyDurationMs: number;
  naturalReplySkippedReason?: string;
  naturalReplyCircuitOpen: boolean;
  naturalReplyCacheHit: boolean;
  naturalReplyModel: string;
  naturalReplyTimeoutMs: number;
  naturalReplyEnabled: boolean;
}

export interface NaturalReplyInput {
  message: string;
  intentAnalysis: AIIntentRouterAnalysis;
  productContext: ProductContext;
  orderState?: ConversationOrderState;
  deterministicReply: string;
}

export interface NaturalReplyResult {
  reply: string;
  meta: NaturalReplyMeta;
}

export interface AllowedFactPack {
  productName?: string;
  priceText?: string;
  offerText?: string;
  availableColors: string[];
  availableSizes: string[];
  deliveryAvailable: boolean;
  deliveryText?: string;
  paymentCodAvailable: boolean;
  paymentText?: string;
  imagesAvailable: boolean;
  storeAddress?: string;
  knownProductNotes: string[];
}
