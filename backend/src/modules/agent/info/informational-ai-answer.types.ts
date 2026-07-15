import type { ProductContext } from "../product-context.types";

export type InformationalAIAnswer = {
  answer: string;
  grounded: boolean;
  cannotAnswer?: boolean;
};

export type InformationalAIAnswerMeta = {
  eligible: boolean;
  usedAI: boolean;
  timedOut: boolean;
  validationFailed: boolean;
  cannotAnswer: boolean;
  durationMs: number;
  skippedReason?: "disabled" | "not_eligible";
};

export type InformationalAIAnswerResult = {
  reply: string;
  meta: InformationalAIAnswerMeta;
};

export type InformationalAIAnswerInput = {
  message: string;
  productContext: ProductContext;
  eligible?: boolean;
};

export type StructuredInformationalGenerator = (
  prompt: string,
  schema?: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<string>;

export type InformationalAIAnswerDependencies = {
  generateStructuredReply?: StructuredInformationalGenerator;
  enabledOverride?: boolean;
};
