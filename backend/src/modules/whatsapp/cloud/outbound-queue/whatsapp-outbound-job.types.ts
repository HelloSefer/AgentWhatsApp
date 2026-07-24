import type { WhatsAppOutboundCommand, WhatsAppOutboundCommandResult } from "./whatsapp-outbound-command.types";

export const WHATSAPP_OUTBOUND_SCHEMA_VERSION = 1;
export const WHATSAPP_OUTBOUND_MAX_COMMANDS = 8;

export type WhatsAppOutboundJobName = "whatsapp-outbound.dispatch";

export type WhatsAppOutboundResponseGroup = Readonly<{
  schemaVersion: typeof WHATSAPP_OUTBOUND_SCHEMA_VERSION;
  sellerId: string;
  conversationKey: string;
  recipient: Readonly<{
    waId: string;
  }>;
  sender: Readonly<{
    phoneNumberId: string;
  }>;
  source: Readonly<{
    type: "inbound_message" | "confirmed_order_receipt" | "runtime_receipt";
    id: string;
  }>;
  responseGroupId: string;
  responseGroupRole: string;
  createdAt: string;
  commands: readonly WhatsAppOutboundCommand[];
}>;

export type WhatsAppOutboundJobData = WhatsAppOutboundResponseGroup;

export type WhatsAppOutboundJobResult = Readonly<{
  ok: boolean;
  commandCount: number;
  commandResults: readonly WhatsAppOutboundCommandResult[];
}>;

export type WhatsAppOutboundGroupDispatchResult = Readonly<{
  accepted: boolean;
  duplicate: boolean;
  jobId?: string;
  commandResults?: readonly WhatsAppOutboundCommandResult[];
}>;

export type WhatsAppOutboundGroupDispatcher = Readonly<{
  dispatchOutboundGroup: (
    group: WhatsAppOutboundResponseGroup,
  ) => Promise<WhatsAppOutboundGroupDispatchResult>;
}>;
