export type CloudInteractiveReplyType = "button_reply" | "list_reply";

export type CloudInteractiveReplyNormalizationResult =
  | {
      kind: "text";
      originalType?: string;
      normalizedText: string;
      normalizedSource: "text_body";
    }
  | {
      kind: "interactive_reply";
      originalType?: string;
      interactiveType: CloudInteractiveReplyType;
      replyId?: string;
      replyTitle?: string;
      normalizedText: string;
      normalizedSource: "known_id_mapping" | "id_value" | "title" | "id";
    }
  | {
      kind: "unsupported";
      originalType?: string;
      normalizedText: string;
      normalizedSource: "unsupported";
      replyId?: string;
      replyTitle?: string;
      error?: string;
    };

const knownReplyIdMappings: Record<string, string> = {
  "first_entry:order_now": "first_entry:order_now",
  "first_entry:more_info": "first_entry:more_info",
  "info:price": "info:price",
  "info:sizes": "info:sizes",
  "info:colors": "info:colors",
  "info:delivery_payment": "info:delivery_payment",
  "info:availability": "info:availability",
  "info:how_to_order": "info:how_to_order",
  "info:order_now": "info:order_now",
  "info:continue_order": "info:continue_order",
  "info:menu": "info:menu",
  "info:more_info": "info:more_info",
  "order:continue": "order:continue",
  "order:confirm": "order:confirm",
  "order:edit": "order:edit",
  "edit:size": "edit:size",
  "edit:color": "edit:color",
  "edit:quantity": "edit:quantity",
  "edit:fullName": "edit:fullName",
  "edit:phone": "edit:phone",
  "edit:city": "edit:city",
  "edit:address": "edit:address",
  "edit:delivery_info": "edit:delivery_info",
  "confirm:yes": "نعم",
  "confirm:edit": "تعديل",
  "confirm:no": "لا",
  order_confirm_yes: "نعم",
  order_confirm_edit: "بغيت نبدل المعلومات",
  order_confirm_no: "إلغاء الطلب",
  color_black: "أسود",
  color_pink: "وردي",
  show_images: "صيفط ليا الصور",
  show_sizes: "شنو المقاسات؟",
  start_order: "بغيت نكومندي",
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReplyId(input: {
  replyId: string;
  replyTitle: string;
}): {
  normalizedText: string;
  normalizedSource: "known_id_mapping" | "id_value" | "title" | "id";
} {
  const mapped = knownReplyIdMappings[input.replyId];

  if (mapped) {
    return {
      normalizedText: mapped,
      normalizedSource: "known_id_mapping",
    };
  }

  if (/^field:skip:[a-zA-Z][a-zA-Z0-9_]*$/u.test(input.replyId)) {
    return {
      normalizedText: input.replyId,
      normalizedSource: "known_id_mapping",
    };
  }

  const separatorIndex = input.replyId.indexOf(":");

  if (separatorIndex > 0 && separatorIndex < input.replyId.length - 1) {
    return {
      normalizedText: input.replyId.slice(separatorIndex + 1).trim(),
      normalizedSource: "id_value",
    };
  }

  if (input.replyTitle) {
    return {
      normalizedText: input.replyTitle,
      normalizedSource: "title",
    };
  }

  return {
    normalizedText: input.replyId,
    normalizedSource: "id",
  };
}

export function normalizeCloudIncomingMessage(
  message: unknown,
): CloudInteractiveReplyNormalizationResult {
  try {
    const candidate = message as any;
    const originalType = cleanString(candidate?.type);

    if (originalType === "text") {
      return {
        kind: "text",
        originalType,
        normalizedText: cleanString(candidate?.text?.body),
        normalizedSource: "text_body",
      };
    }

    if (originalType !== "interactive") {
      return {
        kind: "unsupported",
        originalType,
        normalizedText: "",
        normalizedSource: "unsupported",
      };
    }

    const interactive = candidate?.interactive;
    const interactiveType = cleanString(interactive?.type);
    const payload =
      interactiveType === "button_reply"
        ? interactive?.button_reply
        : interactiveType === "list_reply"
          ? interactive?.list_reply
          : undefined;

    if (interactiveType !== "button_reply" && interactiveType !== "list_reply") {
      return {
        kind: "unsupported",
        originalType,
        normalizedText: "",
        normalizedSource: "unsupported",
      };
    }

    const replyId = cleanString(payload?.id);
    const replyTitle = cleanString(payload?.title);

    if (!replyId && !replyTitle) {
      return {
        kind: "unsupported",
        originalType,
        normalizedText: "",
        normalizedSource: "unsupported",
        error: "Interactive reply is missing id and title",
      };
    }

    const normalized = normalizeReplyId({
      replyId,
      replyTitle,
    });

    return {
      kind: "interactive_reply",
      originalType,
      interactiveType,
      ...(replyId ? { replyId } : {}),
      ...(replyTitle ? { replyTitle } : {}),
      normalizedText: normalized.normalizedText,
      normalizedSource: normalized.normalizedSource,
    };
  } catch (error) {
    return {
      kind: "unsupported",
      normalizedText: "",
      normalizedSource: "unsupported",
      error: error instanceof Error ? error.message : "Invalid message payload",
    };
  }
}
