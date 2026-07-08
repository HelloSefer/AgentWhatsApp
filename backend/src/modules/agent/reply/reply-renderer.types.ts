export type AgentReplyUiHintKind = "none" | "buttons" | "list" | "auto";

export type AgentReplyUiHintPurpose =
  | "order_start"
  | "missing_fields"
  | "confirmation"
  | "field_options"
  | "info_menu";

export type AgentReplyUiHint = {
  kind: AgentReplyUiHintKind;
  purpose?: AgentReplyUiHintPurpose;
  title?: string;
  body?: string;
  options?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
};

export type RenderedAgentReply = {
  text: string;
  ui?: AgentReplyUiHint;
};
