import type { InteractiveSendDecision } from "../../../agent/reply/interactive-send-decision.types";
import type { WhatsAppInteractivePreview } from "../../../agent/reply/whatsapp-interactive.types";

export type WhatsAppOutboundCommandType =
  | "agent_reply"
  | "confirmed_order_receipt"
  | "runtime_receipt_document";

export type WhatsAppOutboundAgentReplyCommand = Readonly<{
  type: "agent_reply";
  to: string;
  replyText: string;
  whatsappInteractivePreview?: WhatsAppInteractivePreview | null;
  interactiveSendDecision?: InteractiveSendDecision | null;
  forceDryRun?: boolean;
  cloudDryRunOverride?: boolean;
  interactiveLiveSendAllowedOverride?: boolean;
  simulateNoProviderCall?: boolean;
}>;

export type WhatsAppOutboundConfirmedOrderReceiptCommand = Readonly<{
  type: "confirmed_order_receipt";
  to: string;
  confirmedOrderId: string;
}>;

export type WhatsAppOutboundRuntimeReceiptDocumentCommand = Readonly<{
  type: "runtime_receipt_document";
  to: string;
  filePath: string;
  filename: string;
  caption: string;
  runtimeDispatch: Readonly<{
    sellerId: string;
    conversationKey: string;
    customerPhone: string;
    productId: string;
    snapshotId: string;
    publicOrderCode: string;
  }>;
}>;

export type WhatsAppOutboundCommand =
  | WhatsAppOutboundAgentReplyCommand
  | WhatsAppOutboundConfirmedOrderReceiptCommand
  | WhatsAppOutboundRuntimeReceiptDocumentCommand;

export type WhatsAppOutboundCommandResult = Readonly<{
  ok: boolean;
  type: WhatsAppOutboundCommandType;
  dryRun: boolean;
  mode?: "text" | "interactive" | "document" | "skipped";
  error?: string;
}>;
