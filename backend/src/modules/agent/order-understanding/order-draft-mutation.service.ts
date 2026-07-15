import type { OrderEntities } from "../agent-brain.types";
import type {
  FieldCandidate,
  OrderFieldProvenance,
  OrderMessageDisposition,
} from "./order-understanding.types";

type ProvenanceMap = Record<string, OrderFieldProvenance>;

const provenanceSourceMap: Record<FieldCandidate["source"], OrderFieldProvenance["source"]> = {
  interactive: "INTERACTIVE",
  deterministic_exact: "DETERMINISTIC_EXACT",
  deterministic_contextual: "DETERMINISTIC_CONTEXTUAL",
};

function hasValue(value: unknown): boolean {
  return typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string"
      ? Boolean(value.trim())
      : value !== undefined && value !== null;
}

function appendAddressPart(existing: string | undefined, incoming: string): string {
  const parts = (existing || "")
    .split(/[،,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const comparable = incoming.trim().toLowerCase();

  if (!parts.some((part) => part.toLowerCase() === comparable)) {
    parts.push(incoming.trim());
  }

  return parts.join("، ");
}

export function applyUnderstandingDecision(input: {
  activeDraft: OrderEntities;
  candidates: FieldCandidate[];
  disposition: OrderMessageDisposition;
  orderCycleId?: string;
  residualExtractionUsed?: boolean;
  existingProvenance?: ProvenanceMap;
}): {
  collected: OrderEntities;
  provenance: ProvenanceMap;
  changedFieldKeys: string[];
} {
  const collected: OrderEntities = { ...input.activeDraft };
  const collectedRecord = collected as Record<string, string | number | undefined>;
  const provenance: ProvenanceMap = { ...(input.existingProvenance || {}) };
  const changedFieldKeys: string[] = [];

  for (const candidate of input.candidates) {
    const previousValue = collectedRecord[candidate.fieldKey];
    let nextValue: string | number | undefined;

    if (candidate.operation === "REMOVE") {
      if (hasValue(previousValue)) {
        delete collectedRecord[candidate.fieldKey];
        delete provenance[candidate.fieldKey];
        changedFieldKeys.push(candidate.fieldKey);
      }
      continue;
    }

    if (candidate.operation === "APPEND" && typeof candidate.value === "string") {
      nextValue = appendAddressPart(
        typeof previousValue === "string" ? previousValue : undefined,
        candidate.value,
      );
    } else if (candidate.operation === "REPLACE" || !hasValue(previousValue)) {
      nextValue = candidate.value;
    } else {
      continue;
    }

    if (previousValue === nextValue) {
      continue;
    }

    collectedRecord[candidate.fieldKey] = nextValue;
    changedFieldKeys.push(candidate.fieldKey);
    provenance[candidate.fieldKey] = {
      source: provenanceSourceMap[candidate.source],
      confidence: candidate.confidence,
      operation: candidate.operation,
      sourceMessageDisposition: input.disposition,
      orderCycleId: input.orderCycleId,
      residualExtractionUsed: input.residualExtractionUsed || undefined,
      acceptedAt: new Date().toISOString(),
    };
  }

  console.log(JSON.stringify({
    event: changedFieldKeys.length
      ? "order_draft.field_mutation_applied"
      : "order_draft.no_field_mutation",
    disposition: input.disposition,
    orderCycleId: input.orderCycleId,
    acceptedCandidateKeys: input.candidates.map((candidate) => candidate.fieldKey),
    stateChangedFieldKeys: changedFieldKeys,
  }));

  return { collected, provenance, changedFieldKeys };
}
