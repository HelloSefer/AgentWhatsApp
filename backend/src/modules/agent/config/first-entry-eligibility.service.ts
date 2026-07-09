import type { ConversationSession } from "../agent-brain.types";
import { normalizeSellerConfig } from "./first-entry-config.service";
import { renderFirstEntryMessage } from "./first-entry-renderer.service";
import type { ProductContext } from "./product-context.types";
import type { SellerConfig } from "./seller-config.types";

export type FirstEntryEligibilityReason =
  | "eligible_new_conversation"
  | "policy_disabled"
  | "already_shown"
  | "has_session_history"
  | "order_flow_active"
  | "order_awaiting_confirmation"
  | "order_confirmed"
  | "edit_flow_active"
  | "info_flow_active"
  | "empty_preview"
  | "unknown_blocker";

export type FirstEntryEligibilityResult = {
  eligible: boolean;
  reason: FirstEntryEligibilityReason;
  previewOnly: true;
  blockers: string[];
  warnings?: string[];
};

type FirstEntryEligibilityInput = {
  sellerConfig: SellerConfig;
  productContext?: ProductContext;
  session?: ConversationSession | unknown;
  orderState?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasMeaningfulText(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

function hasMeaningfulHistory(session: unknown): boolean {
  if (!isRecord(session) || !Array.isArray(session.messages)) {
    return false;
  }

  return session.messages.some((message) => {
    if (!isRecord(message)) {
      return false;
    }

    const role = message.role;

    return (
      (role === "customer" || role === "agent" || role === "system") &&
      hasMeaningfulText(message.text)
    );
  });
}

function getOrderState(input: FirstEntryEligibilityInput): unknown {
  if (input.orderState !== undefined) {
    return input.orderState;
  }

  if (isRecord(input.session)) {
    return input.session.orderState;
  }

  return undefined;
}

function firstEntryAlreadyShown(session: unknown): boolean {
  if (!isRecord(session) || !isRecord(session.firstEntry)) {
    return false;
  }

  return session.firstEntry.shown === true;
}

function hasCollectedOrderFields(orderState: unknown): boolean {
  if (!isRecord(orderState) || !isRecord(orderState.collected)) {
    return false;
  }

  return Object.values(orderState.collected).some((value) => {
    if (typeof value === "string") {
      return Boolean(value.trim());
    }

    return value !== undefined && value !== null;
  });
}

function hasMissingOrderFields(orderState: unknown): boolean {
  return (
    isRecord(orderState) &&
    Array.isArray(orderState.missingFields) &&
    orderState.missingFields.length > 0
  );
}

function isAwaitingConfirmation(orderState: unknown): boolean {
  return isRecord(orderState) && orderState.awaitingConfirmation === true;
}

function isConfirmedOrder(orderState: unknown): boolean {
  return isRecord(orderState) && orderState.confirmed === true;
}

function getActiveFlow(session: unknown): string | undefined {
  if (!isRecord(session)) {
    return undefined;
  }

  const meta = isRecord(session.meta) ? session.meta : undefined;
  const flowState = isRecord(session.flowState) ? session.flowState : undefined;
  const activeFlow =
    session.activeFlow || session.currentFlow || meta?.activeFlow || flowState?.activeFlow;

  return typeof activeFlow === "string" ? activeFlow.trim() : undefined;
}

function hasEditFlow(session: unknown): boolean {
  const activeFlow = getActiveFlow(session);

  if (activeFlow && ["edit", "correction", "order_edit"].includes(activeFlow)) {
    return true;
  }

  if (!isRecord(session)) {
    return false;
  }

  const orderState = isRecord(session.orderState) ? session.orderState : undefined;

  return (
    session.isEditingOrder === true ||
    session.editFlowActive === true ||
    orderState?.isEditing === true ||
    orderState?.editFlowActive === true
  );
}

function hasInfoFlow(session: unknown): boolean {
  const activeFlow = getActiveFlow(session);

  if (activeFlow && ["info", "information", "product_info"].includes(activeFlow)) {
    return true;
  }

  if (!isRecord(session)) {
    return false;
  }

  return session.infoFlowActive === true || session.activeInfoPath === true;
}

function buildBlockedResult(
  reason: FirstEntryEligibilityReason,
  blockers: string[],
  warnings: string[] = [],
): FirstEntryEligibilityResult {
  return {
    eligible: false,
    reason,
    previewOnly: true,
    blockers,
    warnings,
  };
}

export function evaluateFirstEntryEligibility(
  input: FirstEntryEligibilityInput,
): FirstEntryEligibilityResult {
  const normalizedSellerConfig = normalizeSellerConfig(
    input.sellerConfig,
    input.productContext?.price,
  );
  const policy = normalizedSellerConfig.firstEntryPolicy;

  if (!policy.enabled) {
    return buildBlockedResult("policy_disabled", ["policy_disabled"]);
  }

  if (firstEntryAlreadyShown(input.session)) {
    return buildBlockedResult("already_shown", ["already_shown"]);
  }

  if (hasEditFlow(input.session)) {
    return buildBlockedResult("edit_flow_active", ["edit_flow_active"]);
  }

  if (hasInfoFlow(input.session)) {
    return buildBlockedResult("info_flow_active", ["info_flow_active"]);
  }

  const orderState = getOrderState(input);

  if (isConfirmedOrder(orderState)) {
    return buildBlockedResult("order_confirmed", ["order_confirmed"]);
  }

  if (isAwaitingConfirmation(orderState)) {
    return buildBlockedResult("order_awaiting_confirmation", [
      "order_awaiting_confirmation",
    ]);
  }

  if (hasCollectedOrderFields(orderState) || hasMissingOrderFields(orderState)) {
    return buildBlockedResult("order_flow_active", ["order_flow_active"]);
  }

  if (hasMeaningfulHistory(input.session)) {
    return buildBlockedResult("has_session_history", ["has_session_history"]);
  }

  if (input.productContext) {
    const preview = renderFirstEntryMessage({
      sellerConfig: normalizedSellerConfig,
      productContext: input.productContext,
    });

    if (!preview.text.trim()) {
      return buildBlockedResult(
        "empty_preview",
        ["empty_preview"],
        preview.warnings,
      );
    }

    return {
      eligible: true,
      reason: "eligible_new_conversation",
      previewOnly: true,
      blockers: [],
      warnings: preview.warnings,
    };
  }

  return {
    eligible: true,
    reason: "eligible_new_conversation",
    previewOnly: true,
    blockers: [],
    warnings: [],
  };
}

export function markFirstEntryShown<T extends { firstEntry?: ConversationSession["firstEntry"] }>(
  session: T,
  shownAt = new Date().toISOString(),
): T {
  return {
    ...session,
    firstEntry: {
      shown: true,
      shownAt,
    },
  };
}
