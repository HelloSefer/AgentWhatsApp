import { buildOrderUnderstandingContext } from "./understanding-context.builder";
import { extractDeterministicFieldCandidates, isOrderSideQuestion } from "./deterministic-field-extractor.service";
import { mergeFieldCandidates } from "./field-candidate-merger.service";
import { validateContextualCandidate } from "./contextual-field-validator.service";
import { isFieldExtractionDisposition, isSideQuestionDisposition } from "./message-disposition.service";
import type {
  ContextualOrderUnderstandingInput,
  OrderUnderstandingDecision,
  OrderUnderstandingDiagnostics,
} from "./order-understanding.types";

const diagnostics: OrderUnderstandingDiagnostics = {
  total: 0,
  deterministic: 0,
  ai: 0,
  hybrid: 0,
  aiFailures: 0,
  deterministicOnly: true,
};

function logDecision(context: ReturnType<typeof buildOrderUnderstandingContext>, decision: OrderUnderstandingDecision) {
  console.log(JSON.stringify({
    event: "order_understanding.decision",
    mode: decision.mode,
    sellerId: context.sellerId,
    orderCycleId: context.orderCycleId,
    awaitedField: decision.awaitedFieldKey,
    disposition: decision.disposition,
    messageConsumed: decision.messageConsumed,
    residualExtractionUsed: decision.residualExtractionUsed,
    acceptedCandidateKeys: decision.candidates.map((candidate) => candidate.fieldKey),
    rejectedCandidateKeys: decision.rejectedCandidates.map((candidate) => candidate.fieldKey),
    clarificationRequested: decision.needsClarification,
    aiFallbackUsed: decision.aiFallbackUsed,
    deterministicOnly: true,
    durationMs: decision.durationMs,
    customerIdMasked: context.customerId.length > 6 ? `${context.customerId.slice(0, 3)}***${context.customerId.slice(-3)}` : "***",
  }));
}

export async function understandContextualOrderMessage(
  input: ContextualOrderUnderstandingInput,
): Promise<OrderUnderstandingDecision> {
  const startedAt = Date.now();
  const context = buildOrderUnderstandingContext(input);
  const extractionAllowed = context.disposition === "NEW_ORDER"
    ? context.residualExtractionUsed
    : isFieldExtractionDisposition(context.disposition);
  const deterministic = extractionAllowed
    ? extractDeterministicFieldCandidates(context)
    : [];
  const validated = deterministic.map((candidate) => ({ candidate, validation: validateContextualCandidate(candidate, context) }));
  const accepted = validated.flatMap((entry) => entry.validation.candidate ? [entry.validation.candidate] : []);
  const rejectedCandidates = validated.flatMap((entry) => entry.validation.candidate ? [] : [{
    fieldKey: entry.candidate.fieldKey,
    value: entry.candidate.value,
    source: entry.candidate.source,
    reason: entry.validation.reason || "invalid_candidate",
  }]);
  const sideQuestion = isSideQuestionDisposition(context.disposition) || isOrderSideQuestion(context.customerMessage);
  const needsClarification = rejectedCandidates.length > 0 || Boolean(
    extractionAllowed &&
    !sideQuestion &&
    context.awaitedField &&
    context.extractionMessage &&
    accepted.length === 0,
  );
  const clarificationReason = rejectedCandidates[0]?.reason || (
    needsClarification ? "deterministic_value_not_recognized" : undefined
  );
  const merged = mergeFieldCandidates(accepted);
  const mode: OrderUnderstandingDecision["mode"] = accepted.length
    ? "deterministic"
    : "none";
  const decision: OrderUnderstandingDecision = {
    mode,
    candidates: merged,
    rejectedCandidates,
    sideQuestion,
    disposition: context.disposition,
    messageConsumed: context.messageConsumed,
    residualText: context.residualExtractionUsed ? context.extractionMessage : undefined,
    residualExtractionUsed: context.residualExtractionUsed,
    residualFieldHint: context.residualFieldHint,
    awaitedFieldKey: context.awaitedField?.key,
    needsClarification,
    clarificationReason,
    aiFallbackUsed: false,
    durationMs: Date.now() - startedAt,
  };

  diagnostics.total += 1;
  if (mode === "deterministic") diagnostics.deterministic += 1;
  console.log(JSON.stringify({
    event: "order_understanding.message_disposition",
    disposition: context.disposition,
    consumed: context.messageConsumed,
    residualExtractionUsed: context.residualExtractionUsed,
    sellerId: context.sellerId,
    orderCycleId: context.orderCycleId,
  }));
  if (rejectedCandidates.length > 0) {
    console.log(JSON.stringify({
      event: "order_draft.field_mutation_rejected",
      rejectedFieldKeys: rejectedCandidates.map((candidate) => candidate.fieldKey),
      reasons: rejectedCandidates.map((candidate) => candidate.reason),
      disposition: context.disposition,
      orderCycleId: context.orderCycleId,
    }));
  }
  logDecision(context, decision);
  return decision;
}

export function getOrderUnderstandingDiagnostics(): OrderUnderstandingDiagnostics {
  return { ...diagnostics };
}
