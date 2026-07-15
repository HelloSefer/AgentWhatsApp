import type { ConversationOrderState } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { AgentReplyUiHint } from "../reply/reply-renderer.types";

export type OptionalFieldDialogueState = NonNullable<
  ConversationOrderState["optionalFieldDialogue"]
>;

function hasValue(value: unknown): boolean {
  return typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string"
      ? Boolean(value.trim())
      : false;
}

function conditionMatches(
  field: RequiredOrderField,
  collected: Record<string, unknown>,
): boolean {
  const condition = field.condition;

  if (!condition) {
    return true;
  }

  const actual = collected[condition.fieldKey];

  if (typeof condition.exists === "boolean") {
    return condition.exists ? hasValue(actual) : !hasValue(actual);
  }

  return condition.equals === undefined || actual === condition.equals;
}

function isOptionalField(field: RequiredOrderField): boolean {
  return (
    field.enabled &&
    (field.requirement || (field.required ? "REQUIRED" : "OPTIONAL")) ===
      "OPTIONAL"
  );
}

export function getOptionalFieldAskPolicy(
  field: RequiredOrderField,
): "DO_NOT_ASK" | "ASK_ONCE" | "ASK_BEFORE_CONFIRMATION" {
  return field.askPolicy || "DO_NOT_ASK";
}

export function getOptionalFieldDialogueState(input: {
  orderCycleId?: string;
  existing?: ConversationOrderState["optionalFieldDialogue"];
}): OptionalFieldDialogueState {
  const existing = input.existing;

  if (existing && existing.orderCycleId === input.orderCycleId) {
    return {
      orderCycleId: input.orderCycleId,
      askedFieldKeys: [...new Set(existing.askedFieldKeys || [])],
      skippedFieldKeys: [...new Set(existing.skippedFieldKeys || [])],
      activeOptionalFieldKey: existing.activeOptionalFieldKey,
    };
  }

  return {
    orderCycleId: input.orderCycleId,
    askedFieldKeys: [],
    skippedFieldKeys: [],
  };
}

export function getNextOptionalField(input: {
  fields: RequiredOrderField[];
  collected: Record<string, unknown>;
  dialogue: OptionalFieldDialogueState;
}): RequiredOrderField | undefined {
  return [...input.fields]
    .sort((left, right) => {
      const policyRank = (field: RequiredOrderField): number => {
        const policy = getOptionalFieldAskPolicy(field);

        return policy === "ASK_ONCE" ? 0 : policy === "ASK_BEFORE_CONFIRMATION" ? 1 : 2;
      };

      return policyRank(left) - policyRank(right) || left.askOrder - right.askOrder;
    })
    .find((field) => {
      const askPolicy = getOptionalFieldAskPolicy(field);

      return (
        isOptionalField(field) &&
        askPolicy !== "DO_NOT_ASK" &&
        conditionMatches(field, input.collected) &&
        !hasValue(input.collected[field.key]) &&
        !input.dialogue.askedFieldKeys.includes(field.key) &&
        !input.dialogue.skippedFieldKeys.includes(field.key)
      );
    });
}

export function markOptionalFieldPrompted(input: {
  dialogue: OptionalFieldDialogueState;
  fieldKey: string;
}): OptionalFieldDialogueState {
  return {
    ...input.dialogue,
    askedFieldKeys: [...new Set([...input.dialogue.askedFieldKeys, input.fieldKey])],
    activeOptionalFieldKey: input.fieldKey,
  };
}

export function reconcileOptionalFieldDialogue(input: {
  dialogue: OptionalFieldDialogueState;
  collected: Record<string, unknown>;
  fields: RequiredOrderField[];
}): OptionalFieldDialogueState {
  const validOptionalKeys = new Set(
    input.fields
      .filter((field) => isOptionalField(field) && conditionMatches(field, input.collected))
      .map((field) => field.key),
  );
  const askedFieldKeys = [
    ...input.dialogue.askedFieldKeys.filter((key) => validOptionalKeys.has(key)),
    ...[...validOptionalKeys].filter((key) => hasValue(input.collected[key])),
  ];
  const skippedFieldKeys = input.dialogue.skippedFieldKeys.filter((key) =>
    validOptionalKeys.has(key),
  );
  const activeOptionalFieldKey =
    input.dialogue.activeOptionalFieldKey &&
    validOptionalKeys.has(input.dialogue.activeOptionalFieldKey) &&
    !hasValue(input.collected[input.dialogue.activeOptionalFieldKey])
      ? input.dialogue.activeOptionalFieldKey
      : undefined;

  return {
    ...input.dialogue,
    askedFieldKeys: [...new Set(askedFieldKeys)],
    skippedFieldKeys,
    activeOptionalFieldKey,
  };
}

export function parseOptionalFieldSkipAction(message: string): string | undefined {
  return message.trim().match(/^field:skip:([a-zA-Z][a-zA-Z0-9_]*)$/u)?.[1];
}

export function skipOptionalField(input: {
  fieldKey: string;
  fields: RequiredOrderField[];
  collected: Record<string, unknown>;
  dialogue: OptionalFieldDialogueState;
}): { accepted: boolean; reason?: string; dialogue: OptionalFieldDialogueState } {
  const field = input.fields.find((candidate) => candidate.key === input.fieldKey);

  if (!field) {
    return { accepted: false, reason: "unknown_field", dialogue: input.dialogue };
  }

  if (!isOptionalField(field)) {
    return { accepted: false, reason: "field_not_optional", dialogue: input.dialogue };
  }

  if (!conditionMatches(field, input.collected)) {
    return { accepted: false, reason: "field_not_eligible", dialogue: input.dialogue };
  }

  if (input.dialogue.activeOptionalFieldKey !== field.key) {
    return { accepted: false, reason: "field_not_active", dialogue: input.dialogue };
  }

  return {
    accepted: true,
    dialogue: {
      ...input.dialogue,
      askedFieldKeys: [...new Set([...input.dialogue.askedFieldKeys, field.key])],
      skippedFieldKeys: [...new Set([...input.dialogue.skippedFieldKeys, field.key])],
      activeOptionalFieldKey: undefined,
    },
  };
}

export function buildOptionalFieldPrompt(field: RequiredOrderField): {
  text: string;
  ui: AgentReplyUiHint;
} {
  const text = field.prompt || `إلا بغيتي، صيفط ليا ${field.label}.`;

  return {
    text,
    ui: {
      kind: "buttons",
      purpose: "missing_fields",
      title: "معلومة اختيارية",
      body: text,
      options: [
        {
          id: `field:skip:${field.key}`,
          label: "تخطي",
          value: `field:skip:${field.key}`,
        },
      ],
    },
  };
}
