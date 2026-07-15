import qrcode from "qrcode-terminal";
import pino from "pino";
import { generateAgentResult } from "../agent/agent.service";
import type { AgentAction, ChoiceListAction } from "../agent/agent-action.types";
import { conversationKeyService } from "../agent/identity/conversation-key.service";
import { DEFAULT_DEMO_SELLER_ID } from "../agent/identity/seller-resolver.service";
import { env } from "../../config/env";
import { bufferIncomingWhatsappMessage } from "./whatsapp-message-buffer.service";

const SAFE_WHATSAPP_FALLBACK_REPLY =
  "سمح ليا، وقع مشكل صغير. عاود صيفط ليا الرسالة من فضلك.";
const PREVIEW_LENGTH = 90;
const whatsappInteractiveChoiceModes = [
  "auto",
  "list",
  "native_flow",
  "buttons",
  "buttons_test",
  "text",
] as const;

type WhatsAppInteractiveChoiceMode =
  (typeof whatsappInteractiveChoiceModes)[number];

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > PREVIEW_LENGTH
    ? `${normalized.slice(0, PREVIEW_LENGTH)}...`
    : normalized;
}

function maskCustomerId(customerId: string | undefined): string | undefined {
  if (!customerId) {
    return undefined;
  }

  const [phoneOrId, domain] = customerId.split("@");
  const masked =
    phoneOrId.length > 6
      ? `${phoneOrId.slice(0, 3)}***${phoneOrId.slice(-3)}`
      : "***";

  return domain ? `${masked}@${domain}` : masked;
}

function maskConversationKey(conversationKey: string): string {
  const separatorIndex = conversationKey.indexOf(":");

  if (separatorIndex < 0) {
    return maskCustomerId(conversationKey) || "***";
  }

  const sellerId = conversationKey.slice(0, separatorIndex);
  const customerPhone = conversationKey.slice(separatorIndex + 1);

  return `${sellerId}:${maskCustomerId(customerPhone) || "***"}`;
}

function getCustomerPhoneFromJid(jid: string): string {
  return jid.split("@")[0] || jid;
}

function normalizeSelectedChoiceText(text: string): string {
  const trimmed = text.trim();
  if (/^field:skip:[a-zA-Z][a-zA-Z0-9_]*$/u.test(trimmed)) {
    return trimmed;
  }
  const sizeMatch = trimmed.match(/^size:(.+)$/i);

  return sizeMatch?.[1]?.trim() || trimmed;
}

function getConfiguredChoiceMode(): WhatsAppInteractiveChoiceMode {
  return whatsappInteractiveChoiceModes.includes(
    env.whatsappInteractiveChoicesMode as WhatsAppInteractiveChoiceMode,
  )
    ? (env.whatsappInteractiveChoicesMode as WhatsAppInteractiveChoiceMode)
    : "auto";
}

function extractChoiceSelectionFromParamsJson(paramsJson: unknown): string {
  if (typeof paramsJson !== "string" || !paramsJson.trim()) {
    return "";
  }

  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>;
    const selected =
      params.id ||
      params.row_id ||
      params.rowId ||
      params.selectedRowId ||
      params.selectedButtonId ||
      params.title ||
      params.label ||
      params.name;

    return selected ? String(selected) : "";
  } catch (_error) {
    return "";
  }
}

function getIncomingTextDetails(message: any): {
  text: string;
  selectedId?: string;
  choiceType?: ChoiceListAction["choiceType"];
} {
  const isInteractiveResponse = Boolean(
    message.message?.listResponseMessage ||
      message.message?.buttonsResponseMessage ||
      message.message?.templateButtonReplyMessage ||
      message.message?.interactiveResponseMessage?.nativeFlowResponseMessage,
  );
  const rawText =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.message?.listResponseMessage?.title ||
    message.message?.buttonsResponseMessage?.selectedButtonId ||
    message.message?.buttonsResponseMessage?.selectedDisplayText ||
    message.message?.templateButtonReplyMessage?.selectedId ||
    message.message?.templateButtonReplyMessage?.selectedDisplayText ||
    extractChoiceSelectionFromParamsJson(
      message.message?.interactiveResponseMessage?.nativeFlowResponseMessage
        ?.paramsJson,
    ) ||
    "";

  if (rawText) {
    const selectedId = String(rawText);
    const normalizedText = normalizeSelectedChoiceText(selectedId);

    return {
      text: normalizedText,
      selectedId: isInteractiveResponse ? selectedId : undefined,
      choiceType: /^size:/i.test(selectedId) ? "size" : undefined,
    };
  }

  return { text: "" };
}

async function sendChoiceList(input: {
  sock: any;
  to: string;
  action: ChoiceListAction;
}): Promise<{
  fallbackUsed: boolean;
  mode: WhatsAppInteractiveChoiceMode;
  messageKind: "list" | "native_flow" | "buttons" | "text";
  optionCountOriginal: number;
  optionCountSent: number;
  errorMessage?: string;
}> {
  const configuredMode = getConfiguredChoiceMode();
  const modeOrder: WhatsAppInteractiveChoiceMode[] =
    configuredMode === "auto"
      ? ["list", "native_flow", "buttons"]
      : [configuredMode];
  const errors: string[] = [];
  const optionCountOriginal = input.action.options.length;
  const sendFallbackText = async () => {
    await input.sock.sendMessage(input.to, {
      text: input.action.fallbackText,
    });

    return {
      fallbackUsed: true,
      mode: configuredMode,
      messageKind: "text" as const,
      optionCountOriginal,
      optionCountSent: 0,
      errorMessage: errors.join(" | ") || undefined,
    };
  };

  if (!env.whatsappInteractiveChoicesEnabled || configuredMode === "text") {
    return sendFallbackText();
  }

  for (const mode of modeOrder) {
    try {
      if (mode === "list") {
        await input.sock.sendMessage(input.to, {
          title: input.action.title,
          text: input.action.body,
          footer: "",
          buttonText: input.action.buttonText || "اختاري",
          sections: [
            {
              title: input.action.title,
              rows: input.action.options.map((option) => ({
                rowId: option.id,
                title: option.label,
                description: option.description || "",
              })),
            },
          ],
        });

        return {
          fallbackUsed: false,
          mode,
          messageKind: "list",
          optionCountOriginal,
          optionCountSent: input.action.options.length,
        };
      }

      if (mode === "native_flow") {
        await input.sock.sendMessage(input.to, {
          text: input.action.body,
          interactiveButtons: [
            {
              name: "single_select",
              buttonParamsJson: JSON.stringify({
                title: input.action.buttonText || "اختاري",
                sections: [
                  {
                    title: input.action.title,
                    rows: input.action.options.map((option) => ({
                      id: option.id,
                      title: option.label,
                      description: option.description || "",
                    })),
                  },
                ],
              }),
            },
          ],
        });

        return {
          fallbackUsed: false,
          mode,
          messageKind: "native_flow",
          optionCountOriginal,
          optionCountSent: input.action.options.length,
        };
      }

      if (mode === "buttons" || mode === "buttons_test") {
        const buttonOptions =
          mode === "buttons_test" && input.action.choiceType === "size"
            ? input.action.options.slice(0, 2)
            : input.action.options.slice(0, 3);

        await input.sock.sendMessage(input.to, {
          text:
            mode === "buttons_test" && input.action.choiceType === "size"
              ? "اختاري المقاس ديالك:"
              : input.action.body,
          footer: "",
          buttons: buttonOptions.map((option) => ({
            buttonId: option.id,
            buttonText: { displayText: option.label },
            type: 1,
          })),
          headerType: 1,
        });

        return {
          fallbackUsed: false,
          mode,
          messageKind: "buttons",
          optionCountOriginal,
          optionCountSent: buttonOptions.length,
        };
      }
    } catch (error) {
      errors.push(
        `${mode}: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`,
      );
    }
  }

  console.warn(
    "⚠️ WhatsApp choice interactive send failed, using fallback text",
    errors.join(" | "),
  );

  return sendFallbackText();
}

async function sendAgentResult(input: {
  sock: any;
  to: string;
  reply: string;
  actions: AgentAction[];
}): Promise<void> {
  const choiceListAction = input.actions.find(
    (action): action is ChoiceListAction => action.type === "choice_list",
  );

  if (!choiceListAction) {
    await input.sock.sendMessage(input.to, {
      text: input.reply,
    });
    return;
  }

  const sendResult = await sendChoiceList({
    sock: input.sock,
    to: input.to,
    action: choiceListAction,
  });

  console.log(
    JSON.stringify({
      event: "whatsapp.choice_list.send",
      choiceType: choiceListAction.choiceType,
      optionCount: choiceListAction.options.length,
      optionCountOriginal: sendResult.optionCountOriginal,
      optionCountSent: sendResult.optionCountSent,
      interactiveEnabled: env.whatsappInteractiveChoicesEnabled,
      mode: sendResult.mode,
      messageKind: sendResult.messageKind,
      fallbackUsed: sendResult.fallbackUsed,
      context: choiceListAction.context,
      errorMessage: sendResult.errorMessage,
    }),
  );
}

export async function startWhatsApp() {
  const baileys = await import("@whiskeysockets/baileys");

  const makeWASocket = baileys.default;
  const { DisconnectReason, useMultiFileAuthState } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState("auth/whatsapp");

  const sock = makeWASocket({
    auth: state,
    logger: logger as any,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log("❌ WhatsApp connection closed");

      if (shouldReconnect) {
        console.log("🔄 Reconnecting to WhatsApp...");
        startWhatsApp();
      } else {
        console.log("🚪 Logged out from WhatsApp. Scan QR again.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const message = messages[0];

    if (!message.message || message.key.fromMe) {
      return;
    }

    const from = message.key.remoteJid;
    const incomingText = getIncomingTextDetails(message);
    const text = incomingText.text;

    if (incomingText.selectedId) {
      console.log(
        JSON.stringify({
          event: "whatsapp.choice_list.selected",
          choiceType: incomingText.choiceType,
          selectedId: incomingText.selectedId,
          normalizedText: text,
        }),
      );
    }

    console.log("📩 New message received");
    console.log("From:", from);
    console.log("Text:", text);

    if (!from || !text.trim()) {
      return;
    }

    const sellerId = DEFAULT_DEMO_SELLER_ID;
    const customerPhone = getCustomerPhoneFromJid(from);
    const conversationKey = conversationKeyService.buildConversationKey(
      sellerId,
      customerPhone,
    );

    bufferIncomingWhatsappMessage({
      chatId: conversationKeyService.buildBufferKey(conversationKey),
      text,
      onFlush: async (combinedText) => {
        console.log("🧵 WhatsApp message buffer flushed");
        console.log("Combined text:", combinedText);

        try {
          const startedAt = Date.now();
          const result = await generateAgentResult(combinedText, undefined, {
            customerPhone,
            conversationKey,
            sellerId,
            useMemory: true,
          });
          const durationMs = result.meta?.durationMs ?? Date.now() - startedAt;

          console.log(`🤖 Agent source: ${result.source}`);
          console.log(
            JSON.stringify({
              event: "whatsapp.agent.reply",
              customerId: maskConversationKey(conversationKey),
              customerPhone: maskCustomerId(customerPhone),
              sellerId,
              conversationKey: maskConversationKey(conversationKey),
              messagePreview: previewText(combinedText),
              replyPreview: previewText(result.reply),
              source: result.source,
              durationMs,
              useMemory: true,
              sellerBrainReplyKey: result.meta?.sellerBrainReplyKey,
              naturalReplyEnabled: result.meta?.naturalReplyEnabled,
              naturalReplyUsed: result.meta?.naturalReplyUsed,
              intentRouterUsedAI: result.meta?.intentRouterUsedAI,
              intentRouterTimedOut: result.meta?.intentRouterTimedOut,
              intentRouterDurationMs: result.meta?.intentRouterDurationMs,
              orderStateSummary: result.meta?.orderStateSummary,
            }),
          );

          for (const action of result.actions) {
            console.log(`🧭 Agent action planned: ${action.type}`);

            if (action.type === "send_product_images") {
              console.log(
                `🖼️ Image action planned: ${action.images.length} image(s)`,
              );
            }
          }

          await sendAgentResult({
            sock,
            to: from,
            reply: result.reply,
            actions: result.actions,
          });

          console.log("✅ Agent reply sent");
        } catch (error) {
          console.error("❌ Agent reply failed", error);

          await sock.sendMessage(from, {
            text: SAFE_WHATSAPP_FALLBACK_REPLY,
          });
        }
      },
    });
  });

  return sock;
}
