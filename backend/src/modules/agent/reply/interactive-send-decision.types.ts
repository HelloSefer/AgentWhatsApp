export type InteractiveSendMode = "text_only" | "interactive_preview";

export type InteractiveSendDecisionReason =
  | "interactive_disabled"
  | "no_interactive_preview"
  | "preview_available"
  | "unsupported_channel"
  | "unsupported_interactive_type";

export type InteractiveSendChannel =
  | "test"
  | "whatsapp_cloud"
  | "baileys"
  | "unknown";

export type InteractiveSendDecision = {
  mode: InteractiveSendMode;
  reason: InteractiveSendDecisionReason;
  channel: InteractiveSendChannel;
  interactiveEnabled: boolean;
  previewAvailable: boolean;
  interactiveType?: "button" | "list";
};
