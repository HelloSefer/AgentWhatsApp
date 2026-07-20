import type { AgentReplyUiHint } from "./reply-renderer.types";
import type {
  WhatsAppButtonInteractivePreview,
  WhatsAppInteractivePreview,
  WhatsAppListInteractivePreview,
} from "./whatsapp-interactive.types";

const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_LIST_BUTTON_LENGTH = 20;
const MAX_ROW_TITLE_LENGTH = 24;
const MAX_SECTION_TITLE_LENGTH = 24;
const MAX_BODY_LENGTH = 1024;

function cleanText(value: string | undefined, fallback: string): string {
  const cleanValue = value?.replace(/\s+/g, " ").trim();

  return cleanValue || fallback;
}

function cleanBodyText(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return candidate
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  const cleanValue = cleanText(value, "");

  if (cleanValue.length <= maxLength) {
    return cleanValue;
  }

  return cleanValue.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function truncateBodyText(value: string, maxLength: number): string {
  const cleanValue = cleanBodyText(value, "");

  if (cleanValue.length <= maxLength) {
    return cleanValue;
  }

  return cleanValue.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function getBodyText(input: {
  replyText: string;
  replyUi: AgentReplyUiHint;
}): string {
  return truncateBodyText(
    cleanBodyText(input.replyUi.body, input.replyText),
    MAX_BODY_LENGTH,
  );
}

export class WhatsAppInteractiveMapper {
  toCloudInteractivePreview(input: {
    replyText: string;
    replyUi?: AgentReplyUiHint;
  }): WhatsAppInteractivePreview | null {
    const replyUi = input.replyUi;

    if (
      !replyUi ||
      replyUi.kind === "none" ||
      replyUi.kind === "auto" ||
      !replyUi.options?.length
    ) {
      return null;
    }

    if (replyUi.kind === "buttons" && replyUi.options.length <= MAX_BUTTONS) {
      return this.toButtonPreview({
        replyText: input.replyText,
        replyUi,
      });
    }

    if (replyUi.kind === "buttons" || replyUi.kind === "list") {
      return this.toListPreview({
        replyText: input.replyText,
        replyUi,
      });
    }

    return null;
  }

  private toButtonPreview(input: {
    replyText: string;
    replyUi: AgentReplyUiHint;
  }): WhatsAppButtonInteractivePreview {
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: getBodyText(input),
        },
        action: {
          buttons: (input.replyUi.options || []).slice(0, MAX_BUTTONS).map(
            (option) => ({
              type: "reply",
              reply: {
                id: cleanText(option.id, option.label),
                title: truncateText(option.label, MAX_BUTTON_TITLE_LENGTH),
              },
            }),
          ),
        },
      },
    };
  }

  private toListPreview(input: {
    replyText: string;
    replyUi: AgentReplyUiHint;
  }): WhatsAppListInteractivePreview {
    const sectionTitle = truncateText(
      cleanText(input.replyUi.title, "اختيارات"),
      MAX_SECTION_TITLE_LENGTH,
    );

    return {
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: getBodyText(input),
        },
        action: {
          button: truncateText("اختار", MAX_LIST_BUTTON_LENGTH),
          sections: [
            {
              title: sectionTitle,
              rows: (input.replyUi.options || []).map((option) => ({
                id: cleanText(option.id, option.label),
                title: truncateText(option.label, MAX_ROW_TITLE_LENGTH),
                ...(option.value && option.value !== option.label
                  ? { description: truncateText(option.value, 72) }
                  : {}),
              })),
            },
          ],
        },
      },
    };
  }
}

export const whatsappInteractiveMapper = new WhatsAppInteractiveMapper();
