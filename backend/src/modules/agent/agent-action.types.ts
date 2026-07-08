import type { ProductImage } from "./product-context.types";
import type { OrderEntities } from "./agent-brain.types";
import type { AgentIdentity } from "./identity/agent-identity.types";
import type { InteractiveSendDecision } from "./reply/interactive-send-decision.types";
import type { AgentReplyUiHint } from "./reply/reply-renderer.types";
import type { WhatsAppInteractivePreview } from "./reply/whatsapp-interactive.types";

export type AgentActionType = "send_product_images" | "choice_list";

export interface AgentOrderStateSummary {
  isComplete: boolean;
  awaitingConfirmation: boolean;
  confirmed: boolean;
  missingFields: string[];
  requiredFields?: string[];
  requiredFieldKeys?: string[];
  collected?: OrderEntities;
}

export interface SendProductImagesAction {
  type: "send_product_images";
  reason: "customer_requested_images" | "sales_support";
  images: ProductImage[];
}

export interface ChoiceListAction {
  type: "choice_list";
  choiceType: "size" | "color" | "confirmation";
  context?: "missing_size" | "change_size" | "size_question";
  title: string;
  body: string;
  buttonText?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  fallbackText: string;
}

export type AgentAction = SendProductImagesAction | ChoiceListAction;

export type AgentResultSource =
  | "direct"
  | "ai_router"
  | "ai_fallback"
  | "seller_brain";

export interface AgentResult {
  reply: string;
  actions: AgentAction[];
  source: AgentResultSource;
  meta?: {
    naturalReplyUsed?: boolean;
    naturalReplyTimedOut?: boolean;
    naturalReplyValidationFailed?: boolean;
    naturalReplyDurationMs?: number;
    naturalReplySkippedReason?: string;
    naturalReplyCircuitOpen?: boolean;
    naturalReplyCacheHit?: boolean;
    naturalReplyModel?: string;
    naturalReplyTimeoutMs?: number;
    naturalReplyEnabled?: boolean;
    sellerBrainReplyKey?: string;
    sellerBrainRecentReplyKeys?: string[];
    durationMs?: number;
    source?: AgentResultSource;
    orderStateSummary?: AgentOrderStateSummary;
    intentRouterUsedAI?: boolean;
    intentRouterTimedOut?: boolean;
    intentRouterDurationMs?: number;
    identity?: AgentIdentity;
    replyUi?: AgentReplyUiHint;
    whatsappInteractivePreview?: WhatsAppInteractivePreview | null;
    interactiveSendDecision?: InteractiveSendDecision;
  };
}
