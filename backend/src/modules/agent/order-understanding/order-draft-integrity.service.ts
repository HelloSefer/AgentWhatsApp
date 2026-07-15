import type { ConversationOrderState, OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { ProductContext } from "../product-context.types";
import { validateCandidateForField } from "./contextual-field-validator.service";
import { isFieldEffectivelyRequired } from "./understanding-context.builder";
import type { FieldCandidate, OrderFieldProvenance } from "./order-understanding.types";

function hasValue(value: unknown): value is string | number {
  return typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string" && Boolean(value.trim());
}

function hasCompatibleProvenance(provenance: OrderFieldProvenance | undefined): boolean {
  if (!provenance) {
    return true;
  }

  if (["FIELD_INFORMATION", "FIELD_CORRECTION", "UNKNOWN", "EDIT"].includes(provenance.sourceMessageDisposition)) {
    return true;
  }

  return provenance.sourceMessageDisposition === "NEW_ORDER" && provenance.residualExtractionUsed === true;
}

export function validateOrderDraftIntegrity(input: {
  collected: OrderEntities;
  productContext: ProductContext;
  fields: RequiredOrderField[];
  understanding?: ConversationOrderState["understanding"];
}): {
  passed: boolean;
  collected: OrderEntities;
  invalidFieldKeys: string[];
  pendingClarificationFieldKeys: string[];
} {
  const collected: OrderEntities = { ...input.collected };
  const collectedRecord = collected as Record<string, unknown>;
  const effectiveRequiredFields = input.fields.filter((field) =>
    isFieldEffectivelyRequired(field, collectedRecord),
  );
  const invalidFieldKeys: string[] = [];
  const pendingClarificationFieldKeys: string[] = [];

  for (const field of effectiveRequiredFields) {
    const value = collectedRecord[field.key];
    const pending = input.understanding?.fields[field.key]?.pendingCandidate;

    if (pending !== undefined) {
      pendingClarificationFieldKeys.push(field.key);
    }

    if (!hasValue(value)) {
      invalidFieldKeys.push(field.key);
      continue;
    }

    const candidate: FieldCandidate = {
      fieldKey: field.key,
      value,
      operation: "SET",
      confidence: 1,
      source: "deterministic_exact",
    };
    const validation = validateCandidateForField(candidate, field, input.productContext);
    const provenance = input.understanding?.provenance?.[field.key];

    if (!validation.candidate || !hasCompatibleProvenance(provenance) || pending !== undefined) {
      invalidFieldKeys.push(field.key);
    }
  }

  const uniqueInvalidFields = [...new Set(invalidFieldKeys)];
  for (const fieldKey of uniqueInvalidFields) {
    delete collectedRecord[fieldKey];
  }

  const passed = uniqueInvalidFields.length === 0;
  console.log(JSON.stringify({
    event: passed ? "order_draft.integrity_gate_passed" : "order_draft.integrity_gate_failed",
    invalidFieldKeys: uniqueInvalidFields,
    pendingClarificationFieldKeys,
  }));

  return {
    passed,
    collected,
    invalidFieldKeys: uniqueInvalidFields,
    pendingClarificationFieldKeys,
  };
}
