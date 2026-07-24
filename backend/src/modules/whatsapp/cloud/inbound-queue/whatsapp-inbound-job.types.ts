export type WhatsAppInboundJobName = "whatsapp-inbound.process";

export type WhatsAppInboundJobData = Readonly<{
  schemaVersion: 1;
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

export type WhatsAppInboundJobResult = Readonly<{
  ok: boolean;
  handled: boolean;
}>;
