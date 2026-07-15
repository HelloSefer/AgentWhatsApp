import type { FieldCandidate } from "./order-understanding.types";

const sourceRank: Record<FieldCandidate["source"], number> = {
  interactive: 4,
  deterministic_exact: 3,
  deterministic_contextual: 2,
};

export function mergeFieldCandidates(candidates: FieldCandidate[]): FieldCandidate[] {
  const selected = new Map<string, FieldCandidate>();

  for (const candidate of candidates) {
    const current = selected.get(candidate.fieldKey);
    if (!current || sourceRank[candidate.source] > sourceRank[current.source] || (
      sourceRank[candidate.source] === sourceRank[current.source] && candidate.confidence > current.confidence
    )) {
      selected.set(candidate.fieldKey, candidate);
    }
  }

  return [...selected.values()];
}
