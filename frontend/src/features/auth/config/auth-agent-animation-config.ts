export type MessageSender = "agent" | "customer";
export type RiveTriggerName = "bounce" | "think";
export type OrderField = "color" | "delivery" | "quantity";
export type OrderFieldStatus = "hidden" | "validated" | "visible";

export type ChatMessage = Readonly<{
  body: string;
  id: "agent-delivery" | "agent-summary" | "customer-delivery" | "customer-order";
  sender: MessageSender;
}>;

export type OrderFieldState = Readonly<{
  field: OrderField;
  label: string;
  status: OrderFieldStatus;
  value: string;
}>;

export type WorkflowPhase =
  | "active-idle"
  | "agent-response-one"
  | "agent-response-two"
  | "color-validation"
  | "confirmed"
  | "customer-message-one"
  | "customer-message-two"
  | "delivery-validation"
  | "quantity-validation"
  | "settle"
  | "typing-one"
  | "typing-two";

type WorkflowStep = Readonly<{
  confirmationVisible: boolean;
  durationMs: number;
  phase: WorkflowPhase;
  riveTrigger?: RiveTriggerName;
  typingVisible: boolean;
  validatedOrderFields: readonly OrderField[];
  visibleMessageIds: readonly ChatMessage["id"][];
  visibleOrderFields: readonly OrderField[];
}>;

export const authAgentChatMessages: readonly ChatMessage[] = [
  {
    body: "Salam, wach katdirou livraison?",
    id: "customer-delivery",
    sender: "customer",
  },
  {
    body: "Wa 3likom salam 👋 Ah, kanwsslou. Chno hiya lmdina dyalk?",
    id: "agent-delivery",
    sender: "agent",
  },
  {
    body: "Casablanca. Bghit 2, couleur noire.",
    id: "customer-order",
    sender: "customer",
  },
  {
    body: "Mzyan 👌 2 noir l Casablanca. Talab dyalk wajed lta2kid.",
    id: "agent-summary",
    sender: "agent",
  },
];

export const authAgentOrderFields: readonly Omit<OrderFieldState, "status">[] = [
  { field: "delivery", label: "Delivery", value: "Casablanca" },
  { field: "quantity", label: "Quantity", value: "2" },
  { field: "color", label: "Color", value: "Black" },
];

const firstExchange = ["customer-delivery", "agent-delivery"] as const;
const completeConversation = [...firstExchange, "customer-order", "agent-summary"] as const;
const customerOrderConversation = [...firstExchange, "customer-order"] as const;
const noMessages = [] as const;
const noOrderFields = [] as const;
const deliveryField = ["delivery"] as const;
const deliveryAndQuantity = ["delivery", "quantity"] as const;
const allOrderFields = ["delivery", "quantity", "color"] as const;

export const authAgentWorkflow: readonly WorkflowStep[] = [
  {
    confirmationVisible: false,
    durationMs: 1_500,
    phase: "active-idle",
    typingVisible: false,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: noMessages,
    visibleOrderFields: noOrderFields,
  },
  {
    confirmationVisible: false,
    durationMs: 2_000,
    phase: "customer-message-one",
    riveTrigger: "think",
    typingVisible: false,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: ["customer-delivery"],
    visibleOrderFields: noOrderFields,
  },
  {
    confirmationVisible: false,
    durationMs: 1_500,
    phase: "typing-one",
    typingVisible: true,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: ["customer-delivery"],
    visibleOrderFields: noOrderFields,
  },
  {
    confirmationVisible: false,
    durationMs: 2_500,
    phase: "agent-response-one",
    riveTrigger: "bounce",
    typingVisible: false,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: firstExchange,
    visibleOrderFields: noOrderFields,
  },
  {
    confirmationVisible: false,
    durationMs: 2_000,
    phase: "customer-message-two",
    riveTrigger: "think",
    typingVisible: false,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: customerOrderConversation,
    visibleOrderFields: noOrderFields,
  },
  {
    confirmationVisible: false,
    durationMs: 1_500,
    phase: "typing-two",
    typingVisible: true,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: customerOrderConversation,
    visibleOrderFields: noOrderFields,
  },
  {
    confirmationVisible: false,
    durationMs: 750,
    phase: "agent-response-two",
    riveTrigger: "bounce",
    typingVisible: false,
    validatedOrderFields: noOrderFields,
    visibleMessageIds: completeConversation,
    visibleOrderFields: deliveryField,
  },
  {
    confirmationVisible: false,
    durationMs: 750,
    phase: "delivery-validation",
    typingVisible: false,
    validatedOrderFields: deliveryField,
    visibleMessageIds: completeConversation,
    visibleOrderFields: deliveryField,
  },
  {
    confirmationVisible: false,
    durationMs: 750,
    phase: "quantity-validation",
    typingVisible: false,
    validatedOrderFields: deliveryAndQuantity,
    visibleMessageIds: completeConversation,
    visibleOrderFields: deliveryAndQuantity,
  },
  {
    confirmationVisible: false,
    durationMs: 750,
    phase: "color-validation",
    typingVisible: false,
    validatedOrderFields: allOrderFields,
    visibleMessageIds: completeConversation,
    visibleOrderFields: allOrderFields,
  },
  {
    confirmationVisible: true,
    durationMs: 3_000,
    phase: "confirmed",
    riveTrigger: "bounce",
    typingVisible: false,
    validatedOrderFields: allOrderFields,
    visibleMessageIds: completeConversation,
    visibleOrderFields: allOrderFields,
  },
  {
    confirmationVisible: true,
    durationMs: 1_000,
    phase: "settle",
    typingVisible: false,
    validatedOrderFields: allOrderFields,
    visibleMessageIds: completeConversation,
    visibleOrderFields: allOrderFields,
  },
];

export const authAgentAnimationConfig = {
  totalDurationMs: 18_000,
  motion: {
    confirmationPulse: 0.48,
    enter: 0.3,
    exit: 1.2,
    particleDelay: 0.35,
    particleDuration: 4.8,
    riveFade: 0.45,
    slide: 8,
    typingDot: 0.8,
  },
} as const;
