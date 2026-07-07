import type { ChoiceListAction } from "../../agent/agent-action.types";
import type { OrderEntities } from "../../agent/agent-brain.types";

export type WhatsAppCloudMessageType =
  | "text"
  | "interactive"
  | "unsupported";

export interface WhatsAppCloudIncomingMessage {
  phoneNumberId: string;
  waId: string;
  messageId: string;
  timestamp?: string;
  type: WhatsAppCloudMessageType;
  text: string;
  sourceType?: "text" | "button_reply" | "list_reply" | "native_flow_reply";
  buttonReplyId?: string;
  buttonReplyTitle?: string;
  isFlowSubmission?: boolean;
  flowOrder?: OrderEntities;
  flowParseError?: string;
}

export interface WhatsAppCloudSendResult {
  success: boolean;
  dryRun: boolean;
  payload: unknown;
  response?: unknown;
  errorMessage?: string;
  graphCode?: number | string;
  graphDetails?: string;
  mediaId?: string;
}

export interface WhatsAppCloudChoiceListSendInput {
  to: string;
  phoneNumberId: string;
  action: ChoiceListAction;
  fallbackReply: string;
}
