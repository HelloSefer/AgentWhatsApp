export type AgentReplyUiHintKind = "none" | "buttons" | "list" | "auto";

export type AgentReplyUiHintPurpose =
  | "order_start"
  | "missing_fields"
  | "confirmation"
  | "field_options"
  | "info_menu"
  | "first_entry"
  | "cart_review"
  | "delivery_confirmation";

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
  previewOnly?: boolean;
};

export type RenderedAgentReply = {
  text: string;
  ui?: AgentReplyUiHint;
  presentation?: OrderConfirmationPresentation;
};

export type OrderConfirmationPresentation = {
  presentationMode: "split_order_review_and_confirmation";
  messages: [
    { kind: "text"; text: string },
    {
      kind: "interactive_buttons";
      text: string;
      fallbackText: string;
      buttons: Array<{
        id: string;
        label: string;
      }>;
    },
  ];
};
