export type WhatsAppInboundJobName = "whatsapp-inbound.process";

export type WhatsAppInboundJobBaseData = Readonly<{
  sellerId: string;
  conversationKey: string;
  customerPhone: string;
  phoneNumberId: string;
  messageId: string;
  sourceType: string;
  text: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
  timestamp?: string;
}>;

export type WhatsAppInboundOrderingMetadata = Readonly<{
  version: 1;
  orderingKey: string;
  sequence: number;
}>;

export type WhatsAppInboundJobDataV1 = WhatsAppInboundJobBaseData & Readonly<{
  schemaVersion: 1;
}>;

export type WhatsAppInboundJobDataV2 = WhatsAppInboundJobBaseData & Readonly<{
  schemaVersion: 2;
  ordering: WhatsAppInboundOrderingMetadata;
}>;

export type WhatsAppInboundJobData = WhatsAppInboundJobDataV1 | WhatsAppInboundJobDataV2;

export type WhatsAppInboundJobInputData = WhatsAppInboundJobBaseData & Readonly<{
  schemaVersion?: 1 | 2;
}>;

export type WhatsAppInboundJobResult = Readonly<{
  ok: boolean;
  handled: boolean;
  deferred?: boolean;
  alreadyCompleted?: boolean;
}>;
