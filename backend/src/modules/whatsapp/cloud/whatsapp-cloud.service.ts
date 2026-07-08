import crypto from "crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../../config/env";
import { generateAgentResult } from "../../agent/agent.service";
import type {
  AgentOrderStateSummary,
  AgentResult,
  ChoiceListAction,
} from "../../agent/agent-action.types";
import type { WhatsAppInteractivePreview } from "../../agent/reply/whatsapp-interactive.types";
import type { AgentIdentity } from "../../agent/identity/agent-identity.types";
import { conversationKeyService } from "../../agent/identity/conversation-key.service";
import { sellerResolverService } from "../../agent/identity/seller-resolver.service";
import type { OrderEntities } from "../../agent/agent-brain.types";
import { fastAnalyzeCustomerMessage } from "../../agent/fast-intent-analyzer.service";
import {
  getInvalidOrderFields,
  getOrderFieldValidationDiagnostics,
  recordReceiptSkippedInvalidOrderFields,
} from "../../agent/order/order-field-validator.service";
import {
  listConfirmedOrders,
  updateConfirmedOrderReceipt,
  type ConfirmedOrder,
} from "../../agent/order/confirmed-order-store.service";
import { updateConversationOrderState } from "../../agent/session/conversation-session.service";
import {
  buildOrderFormUrl,
  resolveOrderFormBaseUrl,
} from "../../order-form/order-form.service";
import {
  deleteLocalReceiptPdf,
  generateOrderReceiptPdf,
  getOrderReceiptDiagnostics,
  getOrderReceiptRecord,
  recordOrderReceiptDocumentFailed,
  recordOrderReceiptDocumentSent,
  recordOrderReceiptSkipped,
} from "../../order-receipt/order-receipt.service";
import type {
  WhatsAppCloudChoiceListSendInput,
  WhatsAppCloudIncomingMessage,
  WhatsAppCloudSendResult,
} from "./whatsapp-cloud.types";

const GRAPH_API_BASE_URL = "https://graph.facebook.com";
const PREVIEW_LENGTH = 90;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const AUTO_BUTTON_PRESET_TTL_MS = 5 * 60 * 1000;
const processedMessageIds = new Map<string, number>();
const recentAutoButtonPresets = new Map<string, number>();

type WebhookEventType =
  | "verify"
  | "message"
  | "status"
  | "duplicate"
  | "unsupported"
  | "ignored_unknown_phone_number_id"
  | "error";

type CloudWebhookEvent = {
  timestamp: string;
  method: string;
  path: string;
  type: WebhookEventType;
  phoneNumberId?: string;
  waIdMasked?: string;
  messageId?: string;
  messageType?: string;
  textPreview?: string;
  status?: string;
};

type CloudWebhookError = {
  timestamp: string;
  step: string;
  errorMessage: string;
};

type CloudWebhookDiagnosticsState = {
  lastVerifyAt?: string;
  lastIncomingMessageAt?: string;
  lastStatusWebhookAt?: string;
  lastIgnoredUnknownPhoneNumberIdAt?: string;
  lastFlowSentAt?: string;
  lastFlowSubmittedAt?: string;
  lastFlowParseError?: string;
  lastFlowSendError?: string;
  totalIncomingMessages: number;
  totalStatusWebhooks: number;
  totalDuplicates: number;
  totalUnsupportedMessages: number;
  totalIgnoredUnknownPhoneNumberId: number;
  totalFlowsSent: number;
  totalFlowSendErrors: number;
  totalFlowSubmissions: number;
  totalFlowParseErrors: number;
  totalOrderFormFallbackLinksSent: number;
  totalOrderFormFallbackCtaUrlSent: number;
  totalOrderFormFallbackCtaUrlFailed: number;
  totalOrderFormFallbackTextLinksSent: number;
  totalReplyButtonsSent: number;
  totalReplyButtonsFailed: number;
  totalButtonRepliesReceived: number;
  totalReplyButtonEmojiFallbacks: number;
  lastReplyButtonsPresetSent?: ReplyButtonPreset;
  lastReplyButtonsSentAt?: string;
  lastButtonReplyAt?: string;
  totalOrderFormOpened: number;
  totalOrderFormSubmitted: number;
  totalOrderFormTokenInvalid: number;
  lastOrderFormSubmittedAt?: string;
  events: CloudWebhookEvent[];
  lastErrors: CloudWebhookError[];
};

type ProcessCloudWebhookResult = {
  ok: boolean;
  handled: boolean;
  identity?: AgentIdentity;
  agentReplyPreview?: string;
  actionsCount: number;
  sendAttempted: boolean;
  sendSuccess: boolean;
};

type ProcessCloudWebhookOptions = {
  publicBaseUrl?: string;
  allowUnknownPhoneNumberId?: boolean;
};

type ReplyButtonPreset = "order_confirmation" | "color_choice" | "after_price";

type ReplyButton = {
  id: string;
  title: string;
};

type ReplyButtonPresetConfig = {
  bodyText: string;
  buttons: ReplyButton[];
  fallbackButtons: ReplyButton[];
};

const replyButtonPresets: Record<ReplyButtonPreset, ReplyButtonPresetConfig> = {
  order_confirmation: {
    bodyText: "طلبك واجد ✅\nباقي غير التأكيد باش نرسلوه للتحضير.",
    buttons: [
      { id: "order_confirm_yes", title: "✅ نعم أكد" },
      { id: "order_confirm_edit", title: "✏️ نبدل" },
      { id: "order_confirm_no", title: "❌ إلغاء" },
    ],
    fallbackButtons: [
      { id: "order_confirm_yes", title: "نعم أكد" },
      { id: "order_confirm_edit", title: "نبدل" },
      { id: "order_confirm_no", title: "إلغاء" },
    ],
  },
  color_choice: {
    bodyText: "اختار اللون اللي بغيتي 👇",
    buttons: [
      { id: "color_black", title: "⚫ أسود" },
      { id: "color_pink", title: "🌸 وردي" },
      { id: "show_images", title: "📸 الصور" },
    ],
    fallbackButtons: [
      { id: "color_black", title: "أسود" },
      { id: "color_pink", title: "وردي" },
      { id: "show_images", title: "الصور" },
    ],
  },
  after_price: {
    bodyText: "الثمن واضح ✅\nشنو بغيتي دابا؟",
    buttons: [
      { id: "start_order", title: "🛒 نطلب" },
      { id: "show_sizes", title: "📏 المقاسات" },
      { id: "show_images", title: "📸 الصور" },
    ],
    fallbackButtons: [
      { id: "start_order", title: "نطلب" },
      { id: "show_sizes", title: "المقاسات" },
      { id: "show_images", title: "الصور" },
    ],
  },
};

export function isReplyButtonPreset(value: string): value is ReplyButtonPreset {
  return ["order_confirmation", "color_choice", "after_price"].includes(value);
}

const webhookDiagnostics: CloudWebhookDiagnosticsState = {
  totalIncomingMessages: 0,
  totalStatusWebhooks: 0,
  totalDuplicates: 0,
  totalUnsupportedMessages: 0,
  totalIgnoredUnknownPhoneNumberId: 0,
  totalFlowsSent: 0,
  totalFlowSendErrors: 0,
  totalFlowSubmissions: 0,
  totalFlowParseErrors: 0,
  totalOrderFormFallbackLinksSent: 0,
  totalOrderFormFallbackCtaUrlSent: 0,
  totalOrderFormFallbackCtaUrlFailed: 0,
  totalOrderFormFallbackTextLinksSent: 0,
  totalReplyButtonsSent: 0,
  totalReplyButtonsFailed: 0,
  totalButtonRepliesReceived: 0,
  totalReplyButtonEmojiFallbacks: 0,
  totalOrderFormOpened: 0,
  totalOrderFormSubmitted: 0,
  totalOrderFormTokenInvalid: 0,
  events: [],
  lastErrors: [],
};

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > PREVIEW_LENGTH
    ? `${normalized.slice(0, PREVIEW_LENGTH)}...`
    : normalized;
}

function maskPhone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > 6
    ? `${value.slice(0, 3)}***${value.slice(-3)}`
    : "***";
}

function maskConversationKey(conversationKey: string | undefined): string | undefined {
  if (!conversationKey) {
    return undefined;
  }

  const separatorIndex = conversationKey.indexOf(":");

  if (separatorIndex < 0) {
    return maskPhone(conversationKey);
  }

  const sellerId = conversationKey.slice(0, separatorIndex);
  const customerPhone = conversationKey.slice(separatorIndex + 1);

  return `${sellerId}:${maskPhone(customerPhone) || "***"}`;
}

function previewToken(token: string): string | null {
  if (!token) {
    return null;
  }

  if (token.length <= 7) {
    return "***";
  }

  return `${token.slice(0, 3)}...${token.slice(-4)}`;
}

function logJson(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload));
}

function pushDiagnosticEvent(event: CloudWebhookEvent) {
  webhookDiagnostics.events.unshift(event);
  webhookDiagnostics.events = webhookDiagnostics.events.slice(0, 20);
}

function pushDiagnosticError(step: string, errorMessage: string) {
  const error = {
    timestamp: new Date().toISOString(),
    step,
    errorMessage,
  };

  webhookDiagnostics.lastErrors.unshift(error);
  webhookDiagnostics.lastErrors = webhookDiagnostics.lastErrors.slice(0, 20);
  pushDiagnosticEvent({
    timestamp: error.timestamp,
    method: "INTERNAL",
    path: "/api/whatsapp/cloud/webhook",
    type: "error",
  });
}

export function recordCloudWebhookVerify(input: {
  mode: string;
  verifyTokenMatched: boolean;
  challenge?: string;
  success: boolean;
}) {
  const now = new Date().toISOString();

  webhookDiagnostics.lastVerifyAt = now;
  pushDiagnosticEvent({
    timestamp: now,
    method: "GET",
    path: "/api/whatsapp/cloud/webhook",
    type: "verify",
  });
  logJson({
    event: "whatsapp.cloud.webhook.verify",
    mode: input.mode,
    verifyTokenMatched: input.verifyTokenMatched,
    challengePreview: input.challenge ? previewText(input.challenge) : undefined,
    success: input.success,
  });
}

export function getCloudDiagnostics() {
  const receiptDiagnostics = getOrderReceiptDiagnostics();
  const orderFieldDiagnostics = getOrderFieldValidationDiagnostics();

  return {
    ok: true,
    provider: env.whatsappProvider,
    dryRun: env.whatsappCloudDryRun,
    apiVersion: env.whatsappCloudApiVersion,
    phoneNumberIdPresent: Boolean(env.whatsappCloudPhoneNumberId),
    businessAccountIdPresent: Boolean(env.whatsappCloudBusinessAccountId),
    accessTokenPresent: Boolean(env.whatsappCloudAccessToken),
    accessTokenPreview: previewToken(env.whatsappCloudAccessToken),
    verifyTokenPresent: Boolean(env.whatsappCloudVerifyToken),
    signatureVerifyEnabled: env.whatsappCloudWebhookSignatureVerify,
    orderFlowIdPresent: Boolean(env.whatsappCloudOrderFlowId),
    orderFlowScreenId: env.whatsappCloudOrderFlowScreenId,
    orderFlowOnOrderStart: env.whatsappCloudOrderFlowOnOrderStart,
    totalFlowsSent: webhookDiagnostics.totalFlowsSent,
    totalFlowSendErrors: webhookDiagnostics.totalFlowSendErrors,
    totalFlowSubmissions: webhookDiagnostics.totalFlowSubmissions,
    totalFlowParseErrors: webhookDiagnostics.totalFlowParseErrors,
    lastFlowSentAt: webhookDiagnostics.lastFlowSentAt,
    lastFlowSubmittedAt: webhookDiagnostics.lastFlowSubmittedAt,
    lastFlowParseError: webhookDiagnostics.lastFlowParseError,
    lastFlowSendError: webhookDiagnostics.lastFlowSendError,
    totalOrderFormFallbackLinksSent:
      webhookDiagnostics.totalOrderFormFallbackLinksSent,
    totalOrderFormFallbackCtaUrlSent:
      webhookDiagnostics.totalOrderFormFallbackCtaUrlSent,
    totalOrderFormFallbackCtaUrlFailed:
      webhookDiagnostics.totalOrderFormFallbackCtaUrlFailed,
    totalOrderFormFallbackTextLinksSent:
      webhookDiagnostics.totalOrderFormFallbackTextLinksSent,
    totalReplyButtonsSent: webhookDiagnostics.totalReplyButtonsSent,
    totalReplyButtonsFailed: webhookDiagnostics.totalReplyButtonsFailed,
    totalButtonRepliesReceived: webhookDiagnostics.totalButtonRepliesReceived,
    totalReplyButtonEmojiFallbacks:
      webhookDiagnostics.totalReplyButtonEmojiFallbacks,
    lastReplyButtonsPresetSent: webhookDiagnostics.lastReplyButtonsPresetSent,
    lastReplyButtonsSentAt: webhookDiagnostics.lastReplyButtonsSentAt,
    lastButtonReplyAt: webhookDiagnostics.lastButtonReplyAt,
    ...receiptDiagnostics,
    ...orderFieldDiagnostics,
    totalOrderFormOpened: webhookDiagnostics.totalOrderFormOpened,
    totalOrderFormSubmitted: webhookDiagnostics.totalOrderFormSubmitted,
    totalOrderFormTokenInvalid: webhookDiagnostics.totalOrderFormTokenInvalid,
    lastOrderFormSubmittedAt: webhookDiagnostics.lastOrderFormSubmittedAt,
    webhook: {
      postRouteMounted: true,
      getRouteMounted: true,
      lastVerifyAt: webhookDiagnostics.lastVerifyAt,
      lastIncomingMessageAt: webhookDiagnostics.lastIncomingMessageAt,
      lastStatusWebhookAt: webhookDiagnostics.lastStatusWebhookAt,
      lastIgnoredUnknownPhoneNumberIdAt:
        webhookDiagnostics.lastIgnoredUnknownPhoneNumberIdAt,
      totalIncomingMessages: webhookDiagnostics.totalIncomingMessages,
      totalStatusWebhooks: webhookDiagnostics.totalStatusWebhooks,
      totalDuplicates: webhookDiagnostics.totalDuplicates,
      totalUnsupportedMessages: webhookDiagnostics.totalUnsupportedMessages,
      totalIgnoredUnknownPhoneNumberId:
        webhookDiagnostics.totalIgnoredUnknownPhoneNumberId,
      events: webhookDiagnostics.events,
      lastErrors: webhookDiagnostics.lastErrors,
    },
  };
}

export function recordOrderFormOpened() {
  webhookDiagnostics.totalOrderFormOpened += 1;
}

export function recordOrderFormSubmitted() {
  webhookDiagnostics.totalOrderFormSubmitted += 1;
  webhookDiagnostics.lastOrderFormSubmittedAt = new Date().toISOString();
}

export function recordOrderFormTokenInvalid() {
  webhookDiagnostics.totalOrderFormTokenInvalid += 1;
}

function recordOrderFormFallbackLinkSent() {
  webhookDiagnostics.totalOrderFormFallbackLinksSent += 1;
}

function recordOrderFormFallbackCtaUrlSent() {
  webhookDiagnostics.totalOrderFormFallbackCtaUrlSent += 1;
  recordOrderFormFallbackLinkSent();
}

function recordOrderFormFallbackCtaUrlFailed() {
  webhookDiagnostics.totalOrderFormFallbackCtaUrlFailed += 1;
}

function recordOrderFormFallbackTextLinkSent() {
  webhookDiagnostics.totalOrderFormFallbackTextLinksSent += 1;
  recordOrderFormFallbackLinkSent();
}

function recordReplyButtonsSent(preset?: ReplyButtonPreset) {
  webhookDiagnostics.totalReplyButtonsSent += 1;
  webhookDiagnostics.lastReplyButtonsSentAt = new Date().toISOString();

  if (preset) {
    webhookDiagnostics.lastReplyButtonsPresetSent = preset;
  }
}

function recordReplyButtonsFailed() {
  webhookDiagnostics.totalReplyButtonsFailed += 1;
}

function recordReplyButtonEmojiFallback() {
  webhookDiagnostics.totalReplyButtonEmojiFallbacks += 1;
}

function recordButtonReplyReceived() {
  webhookDiagnostics.totalButtonRepliesReceived += 1;
  webhookDiagnostics.lastButtonReplyAt = new Date().toISOString();
}

function isUnknownConfiguredPhoneNumberId(phoneNumberId: string): boolean {
  return Boolean(
    phoneNumberId &&
      env.whatsappCloudPhoneNumberId &&
      phoneNumberId !== env.whatsappCloudPhoneNumberId,
  );
}

function buildCloudAgentIdentity(input: {
  phoneNumberId: string;
  waId: string;
}): AgentIdentity {
  const sellerId = sellerResolverService.resolveSellerIdByPhoneNumberId(
    input.phoneNumberId,
  );
  const customerPhone = input.waId;
  const conversationKey = conversationKeyService.buildConversationKey(
    sellerId,
    customerPhone,
  );

  return {
    sellerId,
    customerPhone,
    conversationKey,
    phoneNumberId: input.phoneNumberId,
  };
}

function recordIgnoredUnknownPhoneNumberId(input: {
  phoneNumberId: string;
  messageId?: string;
  messageType?: string;
  waId?: string;
}) {
  const now = new Date().toISOString();

  webhookDiagnostics.lastIgnoredUnknownPhoneNumberIdAt = now;
  webhookDiagnostics.totalIgnoredUnknownPhoneNumberId += 1;
  pushDiagnosticEvent({
    timestamp: now,
    method: "POST",
    path: "/api/whatsapp/cloud/webhook",
    type: "ignored_unknown_phone_number_id",
    phoneNumberId: input.phoneNumberId,
    waIdMasked: maskPhone(input.waId),
    messageId: input.messageId,
    messageType: input.messageType,
  });
  logJson({
    event: "whatsapp.cloud.webhook.ignored_unknown_phone_number_id",
    receivedPhoneNumberId: input.phoneNumberId,
    expectedPhoneNumberId: env.whatsappCloudPhoneNumberId,
    messageId: input.messageId,
    messageType: input.messageType,
    waId: maskPhone(input.waId),
  });
}

function cleanupDedupeCache() {
  const now = Date.now();

  for (const [messageId, expiresAt] of processedMessageIds.entries()) {
    if (expiresAt <= now) {
      processedMessageIds.delete(messageId);
    }
  }
}

function isDuplicateMessage(messageId: string): boolean {
  cleanupDedupeCache();

  if (processedMessageIds.has(messageId)) {
    return true;
  }

  processedMessageIds.set(messageId, Date.now() + DEDUPE_TTL_MS);

  return false;
}

function getBodyEntries(body: unknown): any[] {
  return Array.isArray((body as any)?.entry) ? (body as any).entry : [];
}

function getBodyChanges(body: unknown): any[] {
  return getBodyEntries(body).flatMap((entry: any) =>
    Array.isArray(entry?.changes) ? entry.changes : [],
  );
}

function inspectWebhookBody(body: unknown) {
  const entries = getBodyEntries(body);
  const changes = getBodyChanges(body);
  const values = changes.map((change: any) => change?.value || {});
  const messagesCount = values.reduce(
    (count, value) => count + (Array.isArray(value?.messages) ? value.messages.length : 0),
    0,
  );
  const statusesCount = values.reduce(
    (count, value) => count + (Array.isArray(value?.statuses) ? value.statuses.length : 0),
    0,
  );

  return {
    object: (body as any)?.object,
    entriesCount: entries.length,
    changesCount: changes.length,
    hasMessages: messagesCount > 0,
    hasStatuses: statusesCount > 0,
    values,
    messagesCount,
    statusesCount,
  };
}

function normalizeSelectedChoiceText(text: string): string {
  const trimmed = text.trim();
  const sizeMatch = trimmed.match(/^size:(.+)$/i);

  return sizeMatch?.[1]?.trim() || trimmed;
}

function mapButtonReplyIdToText(buttonReplyId: string, fallbackText: string): string {
  const mapped: Record<string, string> = {
    order_confirm_yes: "نعم",
    order_confirm_edit: "بغيت نبدل المعلومات",
    order_confirm_no: "إلغاء الطلب",
    color_black: "أسود",
    color_pink: "وردي",
    show_images: "صيفط ليا الصور",
    show_sizes: "شنو المقاسات؟",
    start_order: "بغيت نكومندي",
  };

  return mapped[buttonReplyId] || normalizeSelectedChoiceText(fallbackText);
}

function getInteractiveMessageInfo(message: any): {
  text: string;
  sourceType?: WhatsAppCloudIncomingMessage["sourceType"];
  buttonReplyId?: string;
  buttonReplyTitle?: string;
} {
  const interactive = message?.interactive;

  if (interactive?.button_reply) {
    const buttonReplyId = String(interactive.button_reply.id || "").trim();
    const buttonReplyTitle = String(interactive.button_reply.title || "").trim();
    const text = mapButtonReplyIdToText(
      buttonReplyId,
      buttonReplyTitle || buttonReplyId,
    );

    return {
      text,
      sourceType: "button_reply",
      buttonReplyId,
      buttonReplyTitle,
    };
  }

  if (interactive?.list_reply) {
    const selected =
      interactive.list_reply.id || interactive.list_reply.title || "";

    return {
      text: selected ? normalizeSelectedChoiceText(String(selected)) : "",
      sourceType: "list_reply",
    };
  }

  return { text: "", sourceType: "native_flow_reply" };
}

function getStringField(
  source: Record<string, unknown>,
  fieldNames: string[],
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = source[fieldName];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function parseQuantity(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseFlowOrder(responseJson: string): {
  order?: OrderEntities;
  errorMessage?: string;
} {
  try {
    const parsed = JSON.parse(responseJson) as Record<string, unknown>;
    const order: OrderEntities = {
      fullName: getStringField(parsed, [
        "full_name",
        "fullName",
        "customer_name",
        "name",
      ]),
      phone: getStringField(parsed, ["phone", "phone_number"]),
      city: getStringField(parsed, ["city"]),
      address: getStringField(parsed, ["address"]),
      size: getStringField(parsed, ["size"]),
      color: getStringField(parsed, ["color"]),
      quantity: parseQuantity(getStringField(parsed, ["quantity", "qty"])),
    };

    return { order };
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function getFlowSubmission(message: any): {
  order?: OrderEntities;
  errorMessage?: string;
} | undefined {
  const interactive = message?.interactive;

  if (interactive?.type !== "nfm_reply") {
    return undefined;
  }

  const responseJson = interactive?.nfm_reply?.response_json;

  if (typeof responseJson !== "string" || !responseJson.trim()) {
    return { errorMessage: "Missing nfm_reply.response_json" };
  }

  return parseFlowOrder(responseJson);
}

function extractMessagesFromValue(value: any): WhatsAppCloudIncomingMessage[] {
  const phoneNumberId = String(value?.metadata?.phone_number_id || "");
  const waId = String(value?.contacts?.[0]?.wa_id || "");
  const messages = Array.isArray(value?.messages) ? value.messages : [];

  return messages.flatMap((message: any) => {
    const messageId = String(message?.id || "");
    const from = String(message?.from || waId || "");
    const type = String(message?.type || "unsupported");
    const flowSubmission =
      type === "interactive" ? getFlowSubmission(message) : undefined;
    const interactiveInfo =
      type === "interactive" && !flowSubmission
        ? getInteractiveMessageInfo(message)
        : undefined;
    const text =
      flowSubmission
        ? "flow_submission"
        :
      type === "text"
        ? String(message?.text?.body || "")
        : type === "interactive"
          ? interactiveInfo?.text || ""
          : "";

    if (!phoneNumberId || !from || !messageId || !text.trim()) {
      return [];
    }

    return [
      {
        phoneNumberId,
        waId: from,
        messageId,
        timestamp:
          typeof message?.timestamp === "string" ? message.timestamp : undefined,
        type:
          type === "text" || type === "interactive" ? type : "unsupported",
        text,
        sourceType:
          type === "text" ? "text" : interactiveInfo?.sourceType,
        buttonReplyId: interactiveInfo?.buttonReplyId,
        buttonReplyTitle: interactiveInfo?.buttonReplyTitle,
        isFlowSubmission: Boolean(flowSubmission),
        flowOrder: flowSubmission?.order,
        flowParseError: flowSubmission?.errorMessage,
      },
    ];
  });
}

export function extractIncomingMessages(
  body: unknown,
): WhatsAppCloudIncomingMessage[] {
  const entries = getBodyEntries(body);

  return entries.flatMap((entry: any) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    return changes.flatMap((change: any) =>
      extractMessagesFromValue(change?.value || {}),
    );
  });
}

function recordStatusWebhooks(body: unknown) {
  const values = inspectWebhookBody(body).values;

  for (const value of values) {
    const phoneNumberId = String(value?.metadata?.phone_number_id || "");
    const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

    for (const status of statuses) {
      const recipientId = String(status?.recipient_id || "");
      const messageId = String(status?.id || "");
      const statusText = String(status?.status || "");

      if (isUnknownConfiguredPhoneNumberId(phoneNumberId)) {
        recordIgnoredUnknownPhoneNumberId({
          phoneNumberId,
          waId: recipientId,
          messageId,
          messageType: `status:${statusText}`,
        });
        continue;
      }

      const now = new Date().toISOString();
      webhookDiagnostics.lastStatusWebhookAt = now;
      webhookDiagnostics.totalStatusWebhooks += 1;
      pushDiagnosticEvent({
        timestamp: now,
        method: "POST",
        path: "/api/whatsapp/cloud/webhook",
        type: "status",
        phoneNumberId,
        waIdMasked: maskPhone(recipientId),
        messageId,
        status: statusText,
      });
      logJson({
        event: "whatsapp.cloud.webhook.status",
        phoneNumberId,
        recipientIdMasked: maskPhone(recipientId),
        messageId,
        status: statusText,
      });
    }
  }
}

function recordUnsupportedMessages(body: unknown, supportedMessages: WhatsAppCloudIncomingMessage[]) {
  const supportedIds = new Set(supportedMessages.map((message) => message.messageId));
  const values = inspectWebhookBody(body).values;

  for (const value of values) {
    const phoneNumberId = String(value?.metadata?.phone_number_id || "");
    const waId = String(value?.contacts?.[0]?.wa_id || "");
    const messages = Array.isArray(value?.messages) ? value.messages : [];

    for (const message of messages) {
      const messageId = String(message?.id || "");
      const messageType = String(message?.type || "unknown");
      const from = String(message?.from || waId || "");

      if (messageId && supportedIds.has(messageId)) {
        continue;
      }

      if (isUnknownConfiguredPhoneNumberId(phoneNumberId)) {
        recordIgnoredUnknownPhoneNumberId({
          phoneNumberId,
          waId: from,
          messageId,
          messageType,
        });
        continue;
      }

      const now = new Date().toISOString();
      webhookDiagnostics.totalUnsupportedMessages += 1;
      pushDiagnosticEvent({
        timestamp: now,
        method: "POST",
        path: "/api/whatsapp/cloud/webhook",
        type: "unsupported",
        phoneNumberId,
        waIdMasked: maskPhone(from),
        messageId,
        messageType,
      });
    }
  }
}

export function verifyWebhookSignature(input: {
  signature?: string;
  rawBody?: Buffer;
}): boolean {
  if (
    !env.whatsappCloudWebhookSignatureVerify ||
    !env.whatsappCloudAppSecret
  ) {
    return true;
  }

  if (!input.signature || !input.rawBody) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", env.whatsappCloudAppSecret)
    .update(input.rawBody)
    .digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(input.signature),
  );
}

async function postCloudMessage(
  phoneNumberId: string,
  payload: unknown,
): Promise<WhatsAppCloudSendResult> {
  if (env.whatsappCloudDryRun) {
    return {
      success: true,
      dryRun: true,
      payload,
      response: { dryRun: true },
    };
  }

  if (!env.whatsappCloudAccessToken) {
    pushDiagnosticError("send_cloud_message", "WHATSAPP_CLOUD_ACCESS_TOKEN is required");
    return {
      success: false,
      dryRun: false,
      payload,
      errorMessage: "WHATSAPP_CLOUD_ACCESS_TOKEN is required",
    };
  }

  const response = await fetch(
    `${GRAPH_API_BASE_URL}/${env.whatsappCloudApiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsappCloudAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const graphError =
      typeof responseBody === "object" && responseBody !== null
        ? (responseBody as { error?: Record<string, unknown> }).error
        : undefined;
    const graphMessage =
      typeof graphError?.message === "string" ? graphError.message : undefined;
    const graphCode =
      typeof graphError?.code === "number" || typeof graphError?.code === "string"
        ? graphError.code
        : undefined;
    const graphDetails =
      typeof (graphError?.error_data as Record<string, unknown> | undefined)
        ?.details === "string"
        ? ((graphError?.error_data as Record<string, unknown>).details as string)
        : undefined;
    const errorMessage = [
      `Cloud API returned ${response.status}`,
      graphMessage,
      graphDetails,
    ]
      .filter(Boolean)
      .join(": ");

    pushDiagnosticError(
      "send_cloud_message",
      errorMessage,
    );
    return {
      success: false,
      dryRun: false,
      payload,
      response: responseBody,
      errorMessage,
      graphCode,
      graphDetails,
    };
  }

  return {
    success: true,
    dryRun: false,
    payload,
    response: responseBody,
  };
}

async function callGraphApi(input: {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}) {
  if (!env.whatsappCloudAccessToken) {
    return {
      success: false,
      graphStatus: 400,
      response: null,
      errorMessage: "WHATSAPP_CLOUD_ACCESS_TOKEN is required",
    };
  }

  const response = await fetch(
    `${GRAPH_API_BASE_URL}/${env.whatsappCloudApiVersion}/${input.path}`,
    {
      method: input.method,
      headers: {
        Authorization: `Bearer ${env.whatsappCloudAccessToken}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
  const responseBody = await response.json().catch(() => ({}));

  return {
    success: response.ok,
    graphStatus: response.status,
    response: responseBody,
    errorMessage: response.ok ? undefined : `Graph API returned ${response.status}`,
  };
}

export async function checkSubscribedApps() {
  const result = await callGraphApi({
    method: "GET",
    path: `${env.whatsappCloudBusinessAccountId}/subscribed_apps`,
  });

  logJson({
    event: "whatsapp.cloud.subscribed_apps.check",
    success: result.success,
    graphStatus: result.graphStatus,
  });

  if (!result.success && result.errorMessage) {
    pushDiagnosticError("subscribed_apps_check", result.errorMessage);
  }

  return result;
}

export async function subscribeAppToWaba(subscribedFields?: string[]) {
  const body =
    Array.isArray(subscribedFields) && subscribedFields.length
      ? { subscribed_fields: subscribedFields }
      : undefined;
  const result = await callGraphApi({
    method: "POST",
    path: `${env.whatsappCloudBusinessAccountId}/subscribed_apps`,
    body,
  });

  logJson({
    event: "whatsapp.cloud.subscribed_apps.subscribe",
    success: result.success,
    graphStatus: result.graphStatus,
  });

  if (!result.success && result.errorMessage) {
    pushDiagnosticError("subscribed_apps_subscribe", result.errorMessage);
  }

  return result;
}

export async function sendCloudText(input: {
  to: string;
  phoneNumberId?: string;
  text: string;
}): Promise<WhatsAppCloudSendResult> {
  const phoneNumberId =
    input.phoneNumberId || env.whatsappCloudPhoneNumberId || "";
  const payload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "text",
    text: {
      body: input.text,
    },
  };
  const result = await postCloudMessage(phoneNumberId, payload);

  logJson({
    event: "whatsapp.cloud.send.text",
    to: maskPhone(input.to),
    dryRun: result.dryRun,
    success: result.success,
    errorMessage: result.errorMessage,
  });

  return result;
}

function validateInteractivePreview(
  preview: unknown,
): { ok: true } | { ok: false; errorMessage: string } {
  const candidate = preview as WhatsAppInteractivePreview | undefined;

  if (!candidate || typeof candidate !== "object") {
    return { ok: false, errorMessage: "interactivePreview must be an object" };
  }

  if (candidate.type !== "interactive") {
    return { ok: false, errorMessage: 'interactivePreview.type must be "interactive"' };
  }

  if (!candidate.interactive || typeof candidate.interactive !== "object") {
    return {
      ok: false,
      errorMessage: "interactivePreview.interactive must be an object",
    };
  }

  if (!["button", "list"].includes(candidate.interactive.type)) {
    return {
      ok: false,
      errorMessage: 'interactive.type must be "button" or "list"',
    };
  }

  const bodyText = candidate.interactive.body?.text;

  if (typeof bodyText !== "string" || !bodyText.trim()) {
    return { ok: false, errorMessage: "interactive.body.text is required" };
  }

  if (candidate.interactive.type === "button") {
    const buttons = candidate.interactive.action?.buttons;

    if (!Array.isArray(buttons) || buttons.length < 1) {
      return { ok: false, errorMessage: "button interactive requires buttons" };
    }

    if (buttons.length > 3) {
      return {
        ok: false,
        errorMessage: "button interactive supports at most 3 buttons",
      };
    }

    const invalidButtonIndex = buttons.findIndex(
      (button) =>
        button?.type !== "reply" ||
        typeof button.reply?.id !== "string" ||
        !button.reply.id.trim() ||
        typeof button.reply?.title !== "string" ||
        !button.reply.title.trim(),
    );

    if (invalidButtonIndex >= 0) {
      return {
        ok: false,
        errorMessage: `button ${invalidButtonIndex + 1} requires reply id and title`,
      };
    }

    return { ok: true };
  }

  const action = candidate.interactive.action;

  if (typeof action?.button !== "string" || !action.button.trim()) {
    return { ok: false, errorMessage: "list interactive action.button is required" };
  }

  if (!Array.isArray(action.sections) || action.sections.length < 1) {
    return { ok: false, errorMessage: "list interactive requires sections" };
  }

  for (const [sectionIndex, section] of action.sections.entries()) {
    if (typeof section?.title !== "string" || !section.title.trim()) {
      return {
        ok: false,
        errorMessage: `list section ${sectionIndex + 1} requires title`,
      };
    }

    if (!Array.isArray(section.rows) || section.rows.length < 1) {
      return {
        ok: false,
        errorMessage: `list section ${sectionIndex + 1} requires rows`,
      };
    }

    const invalidRowIndex = section.rows.findIndex(
      (row) =>
        typeof row?.id !== "string" ||
        !row.id.trim() ||
        typeof row?.title !== "string" ||
        !row.title.trim(),
    );

    if (invalidRowIndex >= 0) {
      return {
        ok: false,
        errorMessage: `list section ${sectionIndex + 1} row ${
          invalidRowIndex + 1
        } requires id and title`,
      };
    }
  }

  return { ok: true };
}

export async function sendCloudInteractiveMessage(input: {
  to: string;
  phoneNumberId?: string;
  interactivePreview: WhatsAppInteractivePreview;
  forceDryRun?: boolean;
}): Promise<WhatsAppCloudSendResult> {
  const validation = validateInteractivePreview(input.interactivePreview);
  const phoneNumberId =
    input.phoneNumberId || env.whatsappCloudPhoneNumberId || "";

  if (!validation.ok) {
    logJson({
      event: "whatsapp.cloud.send.interactive",
      to: maskPhone(input.to),
      interactiveType: (input.interactivePreview as any)?.interactive?.type,
      dryRun: Boolean(input.forceDryRun || env.whatsappCloudDryRun),
      success: false,
      validationFailed: true,
      errorMessage: validation.errorMessage,
    });

    return {
      success: false,
      dryRun: Boolean(input.forceDryRun || env.whatsappCloudDryRun),
      payload: null,
      errorMessage: validation.errorMessage,
    };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "interactive",
    interactive: input.interactivePreview.interactive,
  };

  if (input.forceDryRun) {
    const result = {
      success: true,
      dryRun: true,
      payload,
      response: { dryRun: true, forced: true },
    };

    logJson({
      event: "whatsapp.cloud.send.interactive",
      to: maskPhone(input.to),
      interactiveType: input.interactivePreview.interactive.type,
      dryRun: true,
      success: true,
      forcedDryRun: true,
    });

    return result;
  }

  const result = await postCloudMessage(phoneNumberId, payload);

  logJson({
    event: "whatsapp.cloud.send.interactive",
    to: maskPhone(input.to),
    interactiveType: input.interactivePreview.interactive.type,
    dryRun: result.dryRun,
    success: result.success,
    errorMessage: result.errorMessage,
    graphCode: result.graphCode,
    graphDetails: result.graphDetails,
  });

  return result;
}

export async function uploadMedia(input: {
  phoneNumberId?: string;
  filePath: string;
  mimeType: string;
}): Promise<WhatsAppCloudSendResult> {
  const phoneNumberId =
    input.phoneNumberId || env.whatsappCloudPhoneNumberId || "";

  if (env.whatsappCloudDryRun) {
    return {
      success: true,
      dryRun: true,
      payload: {
        phoneNumberId,
        filePath: input.filePath,
        mimeType: input.mimeType,
      },
      response: { dryRun: true, id: `dryrun_media_${Date.now()}` },
      mediaId: `dryrun_media_${Date.now()}`,
    };
  }

  if (!env.whatsappCloudAccessToken) {
    const errorMessage = "WHATSAPP_CLOUD_ACCESS_TOKEN is required";

    pushDiagnosticError("upload_media", errorMessage);
    return {
      success: false,
      dryRun: false,
      payload: {
        filePath: input.filePath,
        mimeType: input.mimeType,
      },
      errorMessage,
    };
  }

  try {
    const fileBuffer = await fs.readFile(input.filePath);
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], {
      type: input.mimeType,
    });

    formData.append("messaging_product", "whatsapp");
    formData.append("type", input.mimeType);
    formData.append("file", blob, path.basename(input.filePath));

    const response = await fetch(
      `${GRAPH_API_BASE_URL}/${env.whatsappCloudApiVersion}/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.whatsappCloudAccessToken}`,
        },
        body: formData,
      },
    );
    const responseBody = await response.json().catch(() => ({}));
    const mediaId =
      typeof (responseBody as { id?: unknown }).id === "string"
        ? (responseBody as { id: string }).id
        : undefined;

    if (!response.ok || !mediaId) {
      const graphError =
        typeof responseBody === "object" && responseBody !== null
          ? (responseBody as { error?: Record<string, unknown> }).error
          : undefined;
      const graphMessage =
        typeof graphError?.message === "string" ? graphError.message : undefined;
      const graphCode =
        typeof graphError?.code === "number" ||
        typeof graphError?.code === "string"
          ? graphError.code
          : undefined;
      const graphDetails =
        typeof (graphError?.error_data as Record<string, unknown> | undefined)
          ?.details === "string"
          ? ((graphError?.error_data as Record<string, unknown>).details as string)
          : undefined;
      const errorMessage = [
        `Cloud media upload returned ${response.status}`,
        graphMessage,
        graphDetails,
      ]
        .filter(Boolean)
        .join(": ");

      pushDiagnosticError("upload_media", errorMessage);
      return {
        success: false,
        dryRun: false,
        payload: {
          filePath: input.filePath,
          mimeType: input.mimeType,
        },
        response: responseBody,
        errorMessage,
        graphCode,
        graphDetails,
      };
    }

    logJson({
      event: "order_receipt.whatsapp.media_uploaded",
      mediaId,
      mimeType: input.mimeType,
    });

    return {
      success: true,
      dryRun: false,
      payload: {
        filePath: input.filePath,
        mimeType: input.mimeType,
      },
      response: responseBody,
      mediaId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    pushDiagnosticError("upload_media", errorMessage);
    return {
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: {
        filePath: input.filePath,
        mimeType: input.mimeType,
      },
      errorMessage,
    };
  }
}

export async function sendDocument(input: {
  to: string;
  phoneNumberId?: string;
  filePath: string;
  filename: string;
  caption?: string;
}): Promise<WhatsAppCloudSendResult> {
  const phoneNumberId =
    input.phoneNumberId || env.whatsappCloudPhoneNumberId || "";
  const uploadResult = await uploadMedia({
    phoneNumberId,
    filePath: input.filePath,
    mimeType: "application/pdf",
  });

  if (!uploadResult.success || !uploadResult.mediaId) {
    logJson({
      event: "order_receipt.whatsapp.document_failed",
      to: maskPhone(input.to),
      step: "upload_media",
      errorMessage: uploadResult.errorMessage,
    });

    await sendCloudText({
      to: input.to,
      phoneNumberId,
      text: "تم تأكيد الطلب ✅ وغادي نرسل لك وصل الطلب بعد قليل.",
    });

    return uploadResult;
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "document",
    document: {
      id: uploadResult.mediaId,
      filename: input.filename,
      caption: input.caption || "هذا وصل الطلب ديالك ✅",
    },
  };
  const result = await postCloudMessage(phoneNumberId, payload);

  logJson({
    event: result.success
      ? "order_receipt.whatsapp.document_sent"
      : "order_receipt.whatsapp.document_failed",
    to: maskPhone(input.to),
    success: result.success,
    mediaId: uploadResult.mediaId,
    filename: input.filename,
    errorMessage: result.errorMessage,
  });

  return {
    ...result,
    mediaId: uploadResult.mediaId,
  };
}

export async function sendOrderReceiptDocumentForOrder(input: {
  to: string;
  phoneNumberId?: string;
  order: ConfirmedOrder;
  allowDuplicate?: boolean;
}): Promise<
  WhatsAppCloudSendResult & {
    pdfPath?: string;
    localFileDeleted?: boolean;
    localFileDeletedAt?: string;
    localFileDeleteError?: string;
    pdfExistsAfterSend?: boolean;
  }
> {
  const existingReceipt = getOrderReceiptRecord(input.order.id);

  if (
    !input.allowDuplicate &&
    (existingReceipt?.sendStatus === "SENT" ||
      input.order.receiptSendStatus === "SENT")
  ) {
    recordOrderReceiptSkipped({
      orderId: input.order.id,
      pdfPath: existingReceipt?.pdfPath || input.order.receiptPdfPath,
    });

    return {
      success: true,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: { skipped: "duplicate_receipt" },
      pdfPath: existingReceipt?.pdfPath || input.order.receiptPdfPath,
      localFileDeleted:
        existingReceipt?.localFileDeleted ||
        input.order.receiptLocalFileDeleted,
      localFileDeletedAt:
        existingReceipt?.localFileDeletedAt ||
        input.order.receiptLocalFileDeletedAt,
    };
  }

  const invalidOrderFields = getInvalidOrderFields(
    {
      fullName: input.order.fullName,
      phone: input.order.phone,
      city: input.order.city,
      address: input.order.address,
      size: input.order.size,
      color: input.order.color,
      quantity: input.order.quantity,
    },
    ["fullName", "phone", "city", "address", "size", "color", "quantity"],
  );

  if (invalidOrderFields.length > 0) {
    recordReceiptSkippedInvalidOrderFields({
      orderId: input.order.id,
      invalidFields: invalidOrderFields,
    });
    updateConfirmedOrderReceipt(input.order.id, {
      receiptSendStatus: "SKIPPED",
    });

    return {
      success: true,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: {
        skipped: "invalid_order_fields",
        invalidFields: invalidOrderFields,
      },
    };
  }

  if (!env.orderReceiptPdfEnabled) {
    updateConfirmedOrderReceipt(input.order.id, {
      receiptSendStatus: "SKIPPED",
    });
    recordOrderReceiptSkipped({
      orderId: input.order.id,
      status: "SKIPPED",
    });

    return {
      success: true,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: { skipped: "receipt_pdf_disabled" },
    };
  }

  if (!env.orderReceiptSendToCustomer) {
    updateConfirmedOrderReceipt(input.order.id, {
      receiptSendStatus: "SKIPPED",
    });
    recordOrderReceiptSkipped({
      orderId: input.order.id,
      status: "SKIPPED",
    });

    return {
      success: true,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: { skipped: "receipt_send_disabled" },
    };
  }

  const pdfResult = await generateOrderReceiptPdf(input.order);

  if (!pdfResult.ok || !pdfResult.pdfPath) {
    const errorMessage = pdfResult.errorMessage || "Receipt PDF generation failed";

    updateConfirmedOrderReceipt(input.order.id, {
      receiptPdfPath: pdfResult.pdfPath,
      receiptSendStatus: "FAILED",
    });
    recordOrderReceiptDocumentFailed({
      orderId: input.order.id,
      pdfPath: pdfResult.pdfPath,
      errorMessage,
    });

    return {
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      errorMessage,
      pdfPath: pdfResult.pdfPath,
    };
  }

  updateConfirmedOrderReceipt(input.order.id, {
    receiptPdfPath: pdfResult.pdfPath,
  });

  const sendResult = await sendDocument({
    to: input.to,
    phoneNumberId: input.phoneNumberId,
    filePath: pdfResult.pdfPath,
    filename: `وصل-الطلب-${input.order.id}.pdf`,
    caption: "هذا وصل الطلب ديالك ✅",
  });

  if (sendResult.success) {
    const deleteResult = env.orderReceiptDeleteAfterSend
      ? await deleteLocalReceiptPdf(input.order.id, pdfResult.pdfPath)
      : {
          localFileDeleted: false,
          pdfExistsAfterSend: true,
        };

    recordOrderReceiptDocumentSent({
      orderId: input.order.id,
      pdfPath: pdfResult.pdfPath,
      mediaId: sendResult.mediaId,
      localFileDeleted: deleteResult.localFileDeleted,
      localFileDeletedAt: deleteResult.localFileDeletedAt,
      localFileDeleteError: deleteResult.localFileDeleteError,
    });
    updateConfirmedOrderReceipt(input.order.id, {
      receiptPdfPath: pdfResult.pdfPath,
      receiptMediaId: sendResult.mediaId,
      receiptSentAt: new Date().toISOString(),
      receiptSendStatus: "SENT",
      receiptLocalFileDeleted: deleteResult.localFileDeleted,
      receiptLocalFileDeletedAt: deleteResult.localFileDeletedAt,
      receiptLocalFileDeleteError: deleteResult.localFileDeleteError,
    });

    return {
      ...sendResult,
      pdfPath: pdfResult.pdfPath,
      ...deleteResult,
    };
  } else {
    const deleteResult = !env.orderReceiptKeepFailedFiles
      ? await deleteLocalReceiptPdf(input.order.id, pdfResult.pdfPath)
      : {
          localFileDeleted: false,
          pdfExistsAfterSend: true,
        };

    recordOrderReceiptDocumentFailed({
      orderId: input.order.id,
      pdfPath: pdfResult.pdfPath,
      errorMessage: sendResult.errorMessage || "Document send failed",
      localFileDeleted: deleteResult.localFileDeleted,
      localFileDeletedAt: deleteResult.localFileDeletedAt,
      localFileDeleteError: deleteResult.localFileDeleteError,
    });
    updateConfirmedOrderReceipt(input.order.id, {
      receiptPdfPath: pdfResult.pdfPath,
      receiptMediaId: sendResult.mediaId,
      receiptSendStatus: "FAILED",
      receiptLocalFileDeleted: deleteResult.localFileDeleted,
      receiptLocalFileDeletedAt: deleteResult.localFileDeletedAt,
      receiptLocalFileDeleteError: deleteResult.localFileDeleteError,
    });

    return {
      ...sendResult,
      pdfPath: pdfResult.pdfPath,
      ...deleteResult,
    };
  }
}

export async function sendCtaUrl(input: {
  to: string;
  phoneNumberId?: string;
  url: string;
  bodyText?: string;
  buttonText?: string;
}): Promise<WhatsAppCloudSendResult> {
  const phoneNumberId =
    input.phoneNumberId || env.whatsappCloudPhoneNumberId || "";
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: {
        text:
          input.bodyText ||
          "باش نكملو الطلب بسرعة، ضغط على الزر وعمّر معلوماتك:",
      },
      action: {
        name: "cta_url",
        parameters: {
          display_text: input.buttonText || "كمّل معلومات الطلب",
          url: input.url,
        },
      },
    },
  };
  const result = await postCloudMessage(phoneNumberId, payload);

  logJson({
    event: "order_form.fallback.cta_url_sent",
    to: maskPhone(input.to),
    dryRun: result.dryRun,
    success: result.success,
    errorMessage: result.errorMessage,
    graphCode: result.graphCode,
    graphDetails: result.graphDetails,
  });

  if (result.success) {
    recordOrderFormFallbackCtaUrlSent();
  } else {
    recordOrderFormFallbackCtaUrlFailed();
    logJson({
      event: "order_form.fallback.cta_url_failed",
      to: maskPhone(input.to),
      errorMessage: result.errorMessage,
      graphCode: result.graphCode,
      graphDetails: result.graphDetails,
    });
  }

  return result;
}

export async function sendReplyButtons(input: {
  to: string;
  phoneNumberId?: string;
  bodyText: string;
  buttons: ReplyButton[];
  emojiFallbackButtons?: ReplyButton[];
  preset?: ReplyButtonPreset;
  fallbackText?: string;
}): Promise<WhatsAppCloudSendResult> {
  const phoneNumberId =
    input.phoneNumberId || env.whatsappCloudPhoneNumberId || "";
  const buildPayload = (buttons: ReplyButton[]) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: input.bodyText,
      },
      action: {
        buttons: buttons.slice(0, 3).map((button) => ({
          type: "reply",
          reply: {
            id: button.id,
            title: button.title,
          },
        })),
      },
    },
  });
  const buttons = input.buttons.slice(0, 3);
  const buttonIds = buttons.map((button) => button.id);
  const sendTextFallback = () =>
    sendCloudText({
      to: input.to,
      phoneNumberId,
      text: input.fallbackText || input.bodyText,
    });

  if (!env.whatsappCloudReplyButtonsEnabled) {
    const fallbackResult = await sendTextFallback();

    logJson({
      event: "whatsapp.cloud.send.reply_buttons",
      to: maskPhone(input.to),
      enabled: false,
      success: fallbackResult.success,
      buttonIds,
      fallbackUsed: true,
      errorMessage: fallbackResult.errorMessage,
    });

    return fallbackResult;
  }

  const payload = buildPayload(buttons);
  const result = await postCloudMessage(phoneNumberId, payload);

  if (result.success) {
    recordReplyButtonsSent(input.preset);
  } else {
    recordReplyButtonsFailed();
  }

  logJson({
    event: "whatsapp.cloud.send.reply_buttons",
    to: maskPhone(input.to),
    success: result.success,
    buttonIds,
    dryRun: result.dryRun,
    errorMessage: result.errorMessage,
    graphCode: result.graphCode,
    graphDetails: result.graphDetails,
  });

  if (!result.success) {
    const fallbackButtons = input.emojiFallbackButtons?.slice(0, 3) || [];

    if (fallbackButtons.length) {
      recordReplyButtonEmojiFallback();
      logJson({
        event: "whatsapp.cloud.reply_buttons.emoji_fallback",
        to: maskPhone(input.to),
        preset: input.preset,
        originalButtonIds: buttonIds,
        errorMessage: result.errorMessage,
      });

      const fallbackPayload = buildPayload(fallbackButtons);
      const fallbackResult = await postCloudMessage(phoneNumberId, fallbackPayload);

      if (fallbackResult.success) {
        recordReplyButtonsSent(input.preset);
      } else {
        recordReplyButtonsFailed();
      }

      logJson({
        event: "whatsapp.cloud.send.reply_buttons",
        to: maskPhone(input.to),
        success: fallbackResult.success,
        buttonIds: fallbackButtons.map((button) => button.id),
        emojiFallback: true,
        dryRun: fallbackResult.dryRun,
        errorMessage: fallbackResult.errorMessage,
        graphCode: fallbackResult.graphCode,
        graphDetails: fallbackResult.graphDetails,
      });

      if (fallbackResult.success) {
        return fallbackResult;
      }
    }

    return sendTextFallback();
  }

  return result;
}

export async function sendReplyButtonPreset(input: {
  to: string;
  phoneNumberId?: string;
  preset: ReplyButtonPreset;
  emoji?: boolean;
  bodyText?: string;
  fallbackText?: string;
}): Promise<WhatsAppCloudSendResult> {
  const preset = replyButtonPresets[input.preset];

  return sendReplyButtons({
    to: input.to,
    phoneNumberId: input.phoneNumberId,
    bodyText: input.bodyText || preset.bodyText,
    buttons: input.emoji === false ? preset.fallbackButtons : preset.buttons,
    emojiFallbackButtons:
      input.emoji === false ? undefined : preset.fallbackButtons,
    preset: input.preset,
    fallbackText: input.fallbackText || input.bodyText || preset.bodyText,
  });
}

export async function sendCloudChoiceList(
  input: WhatsAppCloudChoiceListSendInput,
): Promise<WhatsAppCloudSendResult> {
  const payload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: input.action.body || input.fallbackReply,
      },
      action: {
        button: input.action.buttonText || "اختاري",
        sections: [
          {
            title: input.action.title || "الاختيارات",
            rows: input.action.options.map((option) => ({
              id: option.id,
              title: option.label,
              description: option.description,
            })),
          },
        ],
      },
    },
  };
  const result = await postCloudMessage(input.phoneNumberId, payload);

  logJson({
    event: "whatsapp.cloud.send.interactive_list",
    to: maskPhone(input.to),
    choiceType: input.action.choiceType,
    context: input.action.context,
    optionCount: input.action.options.length,
    dryRun: result.dryRun,
    success: result.success,
    errorMessage: result.errorMessage,
  });

  if (!result.success) {
    return sendCloudText({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      text: input.action.fallbackText || input.fallbackReply,
    });
  }

  return result;
}

export async function sendOrderFlow(
  to: string,
  _options: { customerId?: string } = {},
): Promise<WhatsAppCloudSendResult> {
  if (!env.whatsappCloudOrderFlowId) {
    const errorMessage = "WHATSAPP_CLOUD_ORDER_FLOW_ID is required";

    webhookDiagnostics.totalFlowSendErrors += 1;
    webhookDiagnostics.lastFlowSendError = errorMessage;
    pushDiagnosticError("send_order_flow", errorMessage);

    return {
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      errorMessage,
    };
  }

  const flowActionPayload: {
    screen: string;
    data?: Record<string, unknown>;
  } = {
    screen: env.whatsappCloudOrderFlowScreenId,
  };
  const initialDataText = env.whatsappCloudOrderFlowInitialDataJson.trim();

  if (initialDataText) {
    try {
      const parsedInitialData = JSON.parse(initialDataText) as unknown;

      if (
        typeof parsedInitialData === "object" &&
        parsedInitialData !== null &&
        !Array.isArray(parsedInitialData)
      ) {
        flowActionPayload.data = parsedInitialData as Record<string, unknown>;
      } else {
        logJson({
          event: "whatsapp.cloud.flow.initial_data_parse_error",
          errorMessage: "Initial data JSON must be an object",
        });
      }
    } catch (error) {
      logJson({
        event: "whatsapp.cloud.flow.initial_data_parse_error",
        errorMessage: error instanceof Error ? error.message : "Invalid JSON",
      });
    }
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: {
        text: "باش نكملو الطلب بسرعة، عمّر هاد المعلومات:",
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: env.whatsappCloudOrderFlowId,
          flow_token: `order_form_${Date.now()}`,
          flow_cta: env.whatsappCloudOrderFlowCta,
          flow_action: "navigate",
          flow_action_payload: flowActionPayload,
        },
      },
    },
  };
  const result = await postCloudMessage(env.whatsappCloudPhoneNumberId, payload);

  if (result.success) {
    webhookDiagnostics.totalFlowsSent += 1;
    webhookDiagnostics.lastFlowSentAt = new Date().toISOString();
  } else {
    webhookDiagnostics.totalFlowSendErrors += 1;
    webhookDiagnostics.lastFlowSendError = result.errorMessage;
  }

  logJson({
    event: "whatsapp.cloud.send.flow",
    to: maskPhone(to),
    flowIdPresent: Boolean(env.whatsappCloudOrderFlowId),
    screenId: env.whatsappCloudOrderFlowScreenId,
    cta: env.whatsappCloudOrderFlowCta,
    dryRun: result.dryRun,
    success: result.success,
    errorMessage: result.errorMessage,
    graphCode: result.graphCode,
    graphDetails: result.graphDetails,
  });

  return result;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function buildFlowOrderSummary(order: OrderEntities): string {
  const fields: Array<[string, keyof OrderEntities]> = [
    ["الاسم", "fullName"],
    ["الهاتف", "phone"],
    ["المدينة", "city"],
    ["العنوان", "address"],
    ["المقاس", "size"],
    ["اللون", "color"],
    ["الكمية", "quantity"],
  ];
  const lines = fields.flatMap(([label, key]) => {
    const value = order[key];

    return hasValue(value) ? [`${label}: ${value}`] : [];
  });

  return [
    "توصلت بمعلومات الطلب:",
    "",
    ...lines,
    "",
    "واش نأكد لك الطلب؟",
  ].join("\n");
}

function isFlowIntegrityBlocked(result: WhatsAppCloudSendResult): boolean {
  const details = `${result.graphDetails || ""} ${result.errorMessage || ""}`;

  return (
    result.graphCode === 139000 ||
    details.toLowerCase().includes("integrity requirements not met")
  );
}

function getOrderFormPublicBaseUrl(options?: ProcessCloudWebhookOptions): string {
  return resolveOrderFormBaseUrl(options?.publicBaseUrl).baseUrl;
}

async function sendOrderFormFallbackLink(input: {
  to: string;
  phoneNumberId: string;
  publicBaseUrl?: string;
}): Promise<WhatsAppCloudSendResult> {
  const publicBaseUrl = getOrderFormPublicBaseUrl({
    publicBaseUrl: input.publicBaseUrl,
  });
  const base = resolveOrderFormBaseUrl(input.publicBaseUrl);

  if (!env.orderFormFallbackEnabled) {
    const fallbackText =
      "باش نكملو الطلب هنا فواتساب، عطيني الاسم، الهاتف، المدينة، العنوان، المقاس، اللون والكمية.";

    logJson({
      event: "order_form.fallback.disabled",
      waId: maskPhone(input.to),
      phoneNumberId: input.phoneNumberId,
    });

    return sendCloudText({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      text: fallbackText,
    });
  }

  if (!publicBaseUrl) {
    const fallbackText =
      "أكيد، صيفط ليا الاسم الكامل، رقم الهاتف، المدينة، العنوان، المقاس، اللون والكمية باش نوجد لك الطلب.";

    logJson({
      event: "order_form.fallback.link_error",
      errorMessage: "PUBLIC_BASE_URL is missing and no request base URL is available",
    });

    return sendCloudText({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      text: fallbackText,
    });
  }

  const url = buildOrderFormUrl({
    publicBaseUrl,
    waId: input.to,
    phoneNumberId: input.phoneNumberId,
  });
  const text = [
    "باش نكملو الطلب بسرعة، عمّر هاد الاستمارة:",
    url,
  ].join("\n");

  logJson({
    event: "order_form.link_generated",
    publicBaseUrl: base.baseUrl,
    usedFallbackBaseUrl: base.usedFallbackBaseUrl,
  });

  const sendTextLink = async (): Promise<WhatsAppCloudSendResult> => {
    const textResult = await sendCloudText({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      text,
    });

    if (textResult.success) {
      recordOrderFormFallbackTextLinkSent();
    }

    logJson({
      event: "order_form.fallback.text_link_sent",
      waId: maskPhone(input.to),
      phoneNumberId: input.phoneNumberId,
      publicBaseUrl: base.baseUrl,
      usedFallbackBaseUrl: base.usedFallbackBaseUrl,
      success: textResult.success,
      errorMessage: textResult.errorMessage,
    });

    logJson({
      event: "order_form.fallback.link_sent",
      waId: maskPhone(input.to),
      phoneNumberId: input.phoneNumberId,
      publicBaseUrl: base.baseUrl,
      usedFallbackBaseUrl: base.usedFallbackBaseUrl,
      mode: "text",
      success: textResult.success,
    });

    return textResult;
  };

  if (env.orderFormFallbackSendMode === "text") {
    return sendTextLink();
  }

  const ctaResult = await sendCtaUrl({
    to: input.to,
    phoneNumberId: input.phoneNumberId,
    url,
    bodyText: "باش نكملو الطلب بسرعة، ضغط على الزر وعمّر معلوماتك:",
    buttonText: "كمّل معلومات الطلب",
  });

  if (ctaResult.success) {
    logJson({
      event: "order_form.fallback.link_sent",
      waId: maskPhone(input.to),
      phoneNumberId: input.phoneNumberId,
      publicBaseUrl: base.baseUrl,
      usedFallbackBaseUrl: base.usedFallbackBaseUrl,
      mode: "cta_url",
      success: true,
    });

    return ctaResult;
  }

  return sendTextLink();
}

function getFlowMissingFields(order: OrderEntities): string[] {
  const requiredFields: Array<keyof OrderEntities> = [
    "fullName",
    "phone",
    "city",
    "address",
    "size",
    "color",
    "quantity",
  ];

  return requiredFields.filter((field) => !hasValue(order[field]));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function isFlowTriggerText(text: string): boolean {
  const normalized = normalizeText(text);

  return [
    "form",
    "flow",
    "فورم",
    "نموذج",
    "بغيت الفورم",
    "بغيت نموذج",
    "كملي المعلومات",
    "معلومات الطلب",
  ].some((trigger) => normalized === normalizeText(trigger));
}

function stripConfirmationQuestion(reply: string): string {
  return reply
    .split("\n")
    .filter((line) => !normalizeText(line).includes("واش ناكد لك الطلب"))
    .join("\n")
    .trim();
}

function hasOrderSummary(reply: string): boolean {
  const normalized = normalizeText(reply);

  return (
    normalized.includes("هذا هو الطلب ديالك") ||
    normalized.includes("توصلت بجميع معلومات الطلب")
  );
}

function isColorPrompt(reply: string): boolean {
  const normalized = normalizeText(reply);

  return (
    normalized.includes("شنو اللون") ||
    normalized.includes("اختار اللون") ||
    normalized.includes("اختاري اللون") ||
    normalized.includes("اللون اللي بغيتي")
  );
}

function isPriceQuestion(text: string): boolean {
  const normalized = normalizeText(text);

  return [
    "شحال",
    "بشحال",
    "الثمن",
    "taman",
    "prix",
    "price",
    "bch7al",
    "bach7l",
    "bachhal",
    "ch7al",
    "chhal",
  ].some((keyword) => normalized.includes(normalizeText(keyword)));
}

function shouldSendOrderConfirmationButtons(input: {
  reply: string;
  orderStateSummary?: AgentOrderStateSummary;
}): boolean {
  return (
    input.orderStateSummary?.awaitingConfirmation === true ||
    normalizeText(input.reply).includes("واش ناكد لك الطلب") ||
    hasOrderSummary(input.reply)
  );
}

function shouldSendColorButtons(input: {
  reply: string;
  orderStateSummary?: AgentOrderStateSummary;
}): boolean {
  return (
    input.orderStateSummary?.missingFields.includes("color") === true ||
    isColorPrompt(input.reply)
  );
}

function cleanupRecentAutoButtonPresets() {
  const now = Date.now();

  for (const [key, expiresAt] of recentAutoButtonPresets.entries()) {
    if (expiresAt <= now) {
      recentAutoButtonPresets.delete(key);
    }
  }
}

function shouldSkipRecentAutoButtonPreset(
  customerId: string | undefined,
  preset: ReplyButtonPreset,
): boolean {
  if (!customerId) {
    return false;
  }

  cleanupRecentAutoButtonPresets();

  return recentAutoButtonPresets.has(`${customerId}:${preset}`);
}

function markRecentAutoButtonPreset(
  customerId: string | undefined,
  preset: ReplyButtonPreset,
) {
  if (!customerId) {
    return;
  }

  cleanupRecentAutoButtonPresets();
  recentAutoButtonPresets.set(
    `${customerId}:${preset}`,
    Date.now() + AUTO_BUTTON_PRESET_TTL_MS,
  );
}

async function sendAgentCloudResult(input: {
  to: string;
  phoneNumberId: string;
  customerId: string;
  userMessage: string;
  result: AgentResult;
}): Promise<WhatsAppCloudSendResult> {
  const { result } = input;
  const orderStateSummary = result.meta?.orderStateSummary;

  if (
    shouldSendOrderConfirmationButtons({
      reply: result.reply,
      orderStateSummary,
    })
  ) {
    const summary = stripConfirmationQuestion(result.reply);

    if (summary) {
      await sendCloudText({
        to: input.to,
        phoneNumberId: input.phoneNumberId,
        text: summary,
      });
    }

    return sendReplyButtonPreset({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      preset: "order_confirmation",
      fallbackText:
        "واش نأكد لك الطلب؟ جاوب بنعم للتأكيد، أو قل لي شنو بغيتي تبدل.",
    }).then((sendResult) => {
      logJson({
        event: "whatsapp.cloud.reply_buttons.auto_confirmation_sent",
        waId: maskPhone(input.to),
        success: sendResult.success,
      });

      return sendResult;
    });
  }

  if (
    shouldSendColorButtons({
      reply: result.reply,
      orderStateSummary,
    })
  ) {
    if (result.reply.trim()) {
      await sendCloudText({
        to: input.to,
        phoneNumberId: input.phoneNumberId,
        text: result.reply,
      });
    }

    const sendResult = await sendReplyButtonPreset({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      preset: "color_choice",
      fallbackText: "اختار اللون: أسود أو وردي.",
    });

    logJson({
      event: "whatsapp.cloud.reply_buttons.auto_color_sent",
      waId: maskPhone(input.to),
      success: sendResult.success,
    });

    return sendResult;
  }

  if (isPriceQuestion(input.userMessage)) {
    await sendCloudText({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      text: result.reply,
    });

    if (shouldSkipRecentAutoButtonPreset(input.customerId, "after_price")) {
      return {
        success: true,
        dryRun: env.whatsappCloudDryRun,
        payload: null,
        response: { skipped: "recent_after_price_buttons" },
      };
    }

    const sendResult = await sendReplyButtonPreset({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      preset: "after_price",
      fallbackText: "إلى بغيتي نكمل لك الطلب، قول نطلب.",
    });

    if (sendResult.success) {
      markRecentAutoButtonPreset(input.customerId, "after_price");
    }

    logJson({
      event: "whatsapp.cloud.reply_buttons.auto_after_price_sent",
      waId: maskPhone(input.to),
      success: sendResult.success,
      skippedRecent: false,
    });

    return sendResult;
  }

  const choiceListAction = result.actions.find(
    (action): action is ChoiceListAction => action.type === "choice_list",
  );

  if (choiceListAction) {
    return sendCloudChoiceList({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      action: choiceListAction,
      fallbackReply: result.reply,
    });
  }

  return sendCloudText({
    to: input.to,
    phoneNumberId: input.phoneNumberId,
    text: result.reply,
  });
}

export async function processCloudWebhookBody(
  body: unknown,
  options: ProcessCloudWebhookOptions = {},
): Promise<ProcessCloudWebhookResult> {
  const inspection = inspectWebhookBody(body);

  logJson({
    event: "whatsapp.cloud.webhook.received",
    object: inspection.object,
    entriesCount: inspection.entriesCount,
    changesCount: inspection.changesCount,
    hasMessages: inspection.hasMessages,
    hasStatuses: inspection.hasStatuses,
  });
  recordStatusWebhooks(body);

  const messages = extractIncomingMessages(body);
  recordUnsupportedMessages(body, messages);

  if (!messages.length) {
    const valueKeys = inspection.values.flatMap((value) => Object.keys(value || {}));
    logJson({
      event: "whatsapp.cloud.webhook.no_messages",
      reason: inspection.hasStatuses ? "status_webhook" : "no_supported_messages",
      valueKeys,
    });
    return {
      ok: true,
      handled: false,
      actionsCount: 0,
      sendAttempted: false,
      sendSuccess: false,
    };
  }

  const processResult: ProcessCloudWebhookResult = {
    ok: true,
    handled: false,
    actionsCount: 0,
    sendAttempted: false,
    sendSuccess: false,
  };

  for (const message of messages) {
    if (
      !options.allowUnknownPhoneNumberId &&
      isUnknownConfiguredPhoneNumberId(message.phoneNumberId)
    ) {
      recordIgnoredUnknownPhoneNumberId({
        phoneNumberId: message.phoneNumberId,
        waId: message.waId,
        messageId: message.messageId,
        messageType: message.type,
      });
      continue;
    }

    if (isDuplicateMessage(message.messageId)) {
      const now = new Date().toISOString();
      webhookDiagnostics.totalDuplicates += 1;
      pushDiagnosticEvent({
        timestamp: now,
        method: "POST",
        path: "/api/whatsapp/cloud/webhook",
        type: "duplicate",
        phoneNumberId: message.phoneNumberId,
        waIdMasked: maskPhone(message.waId),
        messageId: message.messageId,
        messageType: message.type,
      });
      logJson({
        event: "whatsapp.cloud.webhook.duplicate",
        messageId: message.messageId,
      });
      continue;
    }

    const identity = buildCloudAgentIdentity({
      phoneNumberId: message.phoneNumberId,
      waId: message.waId,
    });
    const customerId = identity.conversationKey;
    processResult.identity = identity;

    const now = new Date().toISOString();
    webhookDiagnostics.lastIncomingMessageAt = now;
    webhookDiagnostics.totalIncomingMessages += 1;
    pushDiagnosticEvent({
      timestamp: now,
      method: "POST",
      path: "/api/whatsapp/cloud/webhook",
      type: "message",
      phoneNumberId: message.phoneNumberId,
      waIdMasked: maskPhone(message.waId),
      messageId: message.messageId,
      messageType: message.type,
      textPreview: previewText(message.text),
    });
    logJson({
      event: "whatsapp.cloud.webhook.message",
      phoneNumberId: message.phoneNumberId,
      sellerId: identity.sellerId,
      conversationKey: maskConversationKey(identity.conversationKey),
      waId: maskPhone(message.waId),
      messageId: message.messageId,
      messageType: message.type,
      sourceType: message.sourceType,
      buttonReplyId: message.buttonReplyId,
      textPreview: previewText(message.text),
    });

    if (message.sourceType === "button_reply") {
      recordButtonReplyReceived();
      logJson({
        event: "whatsapp.cloud.webhook.button_reply",
        waId: maskPhone(message.waId),
        messageId: message.messageId,
        buttonReplyId: message.buttonReplyId,
        buttonReplyTitle: message.buttonReplyTitle,
        normalizedText: message.text,
      });
      logJson({
        event: "whatsapp.cloud.button_reply.mapped",
        waId: maskPhone(message.waId),
        buttonReplyId: message.buttonReplyId,
        buttonReplyTitle: message.buttonReplyTitle,
        sourceType: message.sourceType,
        normalizedText: message.text,
      });
    }

    try {
      if (message.isFlowSubmission) {
        const fieldsPresent = message.flowOrder
          ? Object.entries(message.flowOrder)
              .filter(([, value]) => hasValue(value))
              .map(([key]) => key)
          : [];

        webhookDiagnostics.totalFlowSubmissions += 1;
        webhookDiagnostics.lastFlowSubmittedAt = new Date().toISOString();

        logJson({
          event: "whatsapp.cloud.flow.submitted",
          waId: maskPhone(message.waId),
          messageId: message.messageId,
          fieldsPresent,
          parseSuccess: Boolean(message.flowOrder && !message.flowParseError),
        });

        if (!message.flowOrder || message.flowParseError) {
          const fallbackText =
            "توصلت بالفورم ولكن ما قدرتش نقرا المعلومات مزيان. عافاك عاودي جربي أو صيفطي المعلومات برسالة.";

          webhookDiagnostics.totalFlowParseErrors += 1;
          webhookDiagnostics.lastFlowParseError =
            message.flowParseError || "Unknown flow parse error";
          logJson({
            event: "whatsapp.cloud.flow.parse_error",
            waId: maskPhone(message.waId),
            messageId: message.messageId,
            errorMessage: webhookDiagnostics.lastFlowParseError,
          });

          const sendResult = await sendCloudText({
            to: message.waId,
            phoneNumberId: message.phoneNumberId,
            text: fallbackText,
          });

          processResult.handled = true;
          processResult.agentReplyPreview = previewText(fallbackText);
          processResult.actionsCount = 0;
          processResult.sendAttempted = true;
          processResult.sendSuccess = sendResult.success;
          continue;
        }

        const missingFields = getFlowMissingFields(message.flowOrder);
        const isComplete = missingFields.length === 0;

        await updateConversationOrderState({
          customerId,
          customerPhone: identity.customerPhone,
          conversationKey: identity.conversationKey,
          sellerId: identity.sellerId,
          collected: message.flowOrder,
          missingFields,
          isComplete,
          awaitingConfirmation: isComplete,
          confirmed: false,
        });

        const reply = buildFlowOrderSummary(message.flowOrder);
        const sendResult = await sendCloudText({
          to: message.waId,
          phoneNumberId: message.phoneNumberId,
          text: reply,
        });

        logJson({
          event: "whatsapp.cloud.flow.confirmation_summary_sent",
          waId: maskPhone(message.waId),
          success: sendResult.success,
        });

        processResult.handled = true;
        processResult.agentReplyPreview = previewText(reply);
        processResult.actionsCount = 0;
        processResult.sendAttempted = true;
        processResult.sendSuccess = sendResult.success;
        continue;
      }

      if (isFlowTriggerText(message.text)) {
        logJson({
          event: "whatsapp.cloud.flow.triggered",
          waId: maskPhone(message.waId),
          triggerTextPreview: previewText(message.text),
        });

        const flowResult = await sendOrderFlow(message.waId, { customerId });
        const sendResult =
          !flowResult.success && isFlowIntegrityBlocked(flowResult)
            ? await sendOrderFormFallbackLink({
                to: message.waId,
                phoneNumberId: message.phoneNumberId,
                publicBaseUrl: options.publicBaseUrl,
              })
            : flowResult;

        processResult.handled = true;
        processResult.agentReplyPreview = flowResult.success
          ? "WhatsApp Flow sent"
          : "Order form fallback sent";
        processResult.actionsCount = 0;
        processResult.sendAttempted = true;
        processResult.sendSuccess = sendResult.success;
        continue;
      }

      if (
        env.whatsappCloudOrderFlowOnOrderStart &&
        fastAnalyzeCustomerMessage(message.text)?.intent === "order_intent"
      ) {
        logJson({
          event: "whatsapp.cloud.flow.triggered",
          waId: maskPhone(message.waId),
          triggerTextPreview: previewText(message.text),
        });

        const flowResult = await sendOrderFlow(message.waId, { customerId });
        const sendResult =
          !flowResult.success && isFlowIntegrityBlocked(flowResult)
            ? await sendOrderFormFallbackLink({
                to: message.waId,
                phoneNumberId: message.phoneNumberId,
                publicBaseUrl: options.publicBaseUrl,
              })
            : flowResult;

        processResult.handled = true;
        processResult.agentReplyPreview = flowResult.success
          ? "WhatsApp Flow sent"
          : "Order form fallback sent";
        processResult.actionsCount = 0;
        processResult.sendAttempted = true;
        processResult.sendSuccess = sendResult.success;
        continue;
      }

      const startedAt = Date.now();
      const result = await generateAgentResult(message.text, undefined, {
        customerPhone: identity.customerPhone,
        conversationKey: identity.conversationKey,
        sellerId: identity.sellerId,
        phoneNumberId: identity.phoneNumberId,
        useMemory: true,
      });
      const durationMs = result.meta?.durationMs ?? Date.now() - startedAt;

      logJson({
        event: "whatsapp.cloud.agent.reply",
        customerId: maskConversationKey(customerId),
        customerPhone: maskPhone(identity.customerPhone),
        sellerId: identity.sellerId,
        conversationKey: maskConversationKey(identity.conversationKey),
        messagePreview: previewText(message.text),
        replyPreview: previewText(result.reply),
        source: result.source,
        durationMs,
        actionsCount: result.actions.length,
        orderStateSummary: result.meta?.orderStateSummary,
      });

      const sendResult = await sendAgentCloudResult({
        to: message.waId,
        phoneNumberId: message.phoneNumberId,
        customerId,
        userMessage: message.text,
        result,
      });

      processResult.handled = true;
      processResult.agentReplyPreview = previewText(result.reply);
      processResult.actionsCount = result.actions.length;
      processResult.sendAttempted = true;
      processResult.sendSuccess = sendResult.success;

      if (result.meta?.orderStateSummary?.confirmed) {
        const confirmedOrder = listConfirmedOrders({
          customerId,
        })[0];

        if (confirmedOrder) {
          sendOrderReceiptDocumentForOrder({
            to: message.waId,
            phoneNumberId: message.phoneNumberId,
            order: confirmedOrder,
          }).catch((error) => {
            logJson({
              event: "order_receipt.whatsapp.document_failed",
              waId: maskPhone(message.waId),
              errorMessage:
                error instanceof Error ? error.message : "Unknown error",
            });
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      pushDiagnosticError("process_message", errorMessage);
      logJson({
        event: "whatsapp.cloud.error",
        step: "process_message",
        errorMessage,
      });
    }
  }

  return processResult;
}

export function buildSimulatedIncomingWebhook(input: {
  from: string;
  phoneNumberId?: string;
  text?: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
}) {
  const hasButtonReply = Boolean(input.buttonReplyId);
  const message = hasButtonReply
    ? {
        id: `wamid.sim.${Date.now()}.${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        from: input.from,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: {
            id: input.buttonReplyId,
            title: input.buttonReplyTitle || input.buttonReplyId,
          },
        },
      }
    : {
        id: `wamid.sim.${Date.now()}.${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        from: input.from,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        type: "text",
        text: {
          body: input.text || "",
        },
      };

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                phone_number_id:
                  input.phoneNumberId ||
                  env.whatsappCloudPhoneNumberId ||
                  "local-test",
              },
              contacts: [
                {
                  wa_id: input.from,
                },
              ],
              messages: [
                message,
              ],
            },
          },
        ],
      },
    ],
  };
}
