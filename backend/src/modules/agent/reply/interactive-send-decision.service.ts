import type {
  InteractiveSendChannel,
  InteractiveSendDecision,
} from "./interactive-send-decision.types";
import type { WhatsAppInteractivePreview } from "./whatsapp-interactive.types";

function getInteractiveType(
  preview: unknown,
): "button" | "list" | undefined {
  const candidate = preview as Partial<WhatsAppInteractivePreview> | null;
  const type = candidate?.interactive?.type;

  return type === "button" || type === "list" ? type : undefined;
}

function isSupportedChannel(channel: InteractiveSendChannel): boolean {
  return channel === "test" || channel === "whatsapp_cloud";
}

export class InteractiveSendDecisionService {
  decide(input: {
    channel: InteractiveSendChannel;
    interactiveEnabled: boolean;
    whatsappInteractivePreview?: unknown | null;
  }): InteractiveSendDecision {
    const interactiveType = getInteractiveType(input.whatsappInteractivePreview);
    const previewAvailable = Boolean(interactiveType);
    const base = {
      channel: input.channel,
      interactiveEnabled: input.interactiveEnabled,
      previewAvailable,
      ...(interactiveType ? { interactiveType } : {}),
    };

    if (!input.interactiveEnabled) {
      return {
        ...base,
        mode: "text_only",
        reason: "interactive_disabled",
      };
    }

    if (!previewAvailable) {
      return {
        ...base,
        mode: "text_only",
        reason: "no_interactive_preview",
      };
    }

    if (!isSupportedChannel(input.channel)) {
      return {
        ...base,
        mode: "text_only",
        reason: "unsupported_channel",
      };
    }

    if (!interactiveType) {
      return {
        ...base,
        mode: "text_only",
        reason: "unsupported_interactive_type",
      };
    }

    return {
      ...base,
      mode: "interactive_preview",
      reason: "preview_available",
    };
  }
}

export const interactiveSendDecisionService =
  new InteractiveSendDecisionService();
