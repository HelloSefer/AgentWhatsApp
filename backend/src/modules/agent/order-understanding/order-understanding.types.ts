import type { ConversationSession, OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { ProductContext } from "../product-context.types";

export type FieldCandidateOperation = "SET" | "REPLACE" | "APPEND" | "REMOVE";
export type FieldCandidateSource =
  | "interactive"
  | "deterministic_exact"
  | "deterministic_contextual";

export type OrderMessageDisposition =
  | "NEW_ORDER"
  | "CONFIRM"
  | "EDIT"
  | "CANCEL"
  | "GREETING"
  | "THANKS"
  | "PRICE_QUESTION"
  | "DELIVERY_QUESTION"
  | "PAYMENT_QUESTION"
  | "AVAILABILITY_QUESTION"
  | "PRODUCT_INFO_QUESTION"
  | "FIELD_INFORMATION"
  | "FIELD_CORRECTION"
  | "UNKNOWN";

export type OrderFieldProvenanceSource =
  | "INTERACTIVE"
  | "DETERMINISTIC_EXACT"
  | "DETERMINISTIC_CONTEXTUAL";

export type OrderFieldProvenance = {
  source: OrderFieldProvenanceSource;
  confidence: number;
  operation: FieldCandidateOperation;
  sourceMessageDisposition: OrderMessageDisposition;
  orderCycleId?: string;
  residualExtractionUsed?: boolean;
  acceptedAt: string;
};

export type FieldCandidate = {
  fieldKey: string;
  value: string | number;
  operation: FieldCandidateOperation;
  confidence: number;
  source: FieldCandidateSource;
};

export type RejectedFieldCandidate = Pick<FieldCandidate, "fieldKey" | "value" | "source"> & {
  reason: string;
};

export type OrderUnderstandingContext = {
  sellerId?: string;
  conversationKey?: string;
  orderCycleId?: string;
  customerId: string;
  customerMessage: string;
  extractionMessage: string;
  disposition: OrderMessageDisposition;
  messageConsumed: boolean;
  residualExtractionUsed: boolean;
  residualDisposition?: OrderMessageDisposition;
  residualFieldHint?: "city";
  productContext: ProductContext;
  session: ConversationSession;
  fields: RequiredOrderField[];
  effectiveRequiredFields: RequiredOrderField[];
  optionalFields: RequiredOrderField[];
  missingFields: string[];
  awaitedField?: RequiredOrderField;
  recentMessages: ConversationSession["messages"];
};

export type OrderUnderstandingDecision = {
  mode: "deterministic" | "none";
  candidates: FieldCandidate[];
  rejectedCandidates: RejectedFieldCandidate[];
  sideQuestion: boolean;
  disposition: OrderMessageDisposition;
  messageConsumed: boolean;
  residualText?: string;
  residualExtractionUsed: boolean;
  residualFieldHint?: "city";
  awaitedFieldKey?: string;
  needsClarification: boolean;
  clarificationReason?: string;
  aiFallbackUsed: false;
  durationMs: number;
};

export type ContextualOrderUnderstandingInput = {
  customerId: string;
  message: string;
  productContext: ProductContext;
  session: ConversationSession;
  fields?: RequiredOrderField[];
};

export type OrderUnderstandingDiagnostics = {
  total: number;
  deterministic: number;
  /** Compatibility counters retained for diagnostics; order collection never calls AI. */
  ai: 0;
  hybrid: 0;
  aiFailures: 0;
  deterministicOnly: true;
};

export type OrderFieldValues = OrderEntities & Record<string, string | number | undefined>;
