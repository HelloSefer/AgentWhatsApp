export type WhatsAppInteractivePreview =
  | WhatsAppButtonInteractivePreview
  | WhatsAppListInteractivePreview;

export type WhatsAppButtonInteractivePreview = {
  type: "interactive";
  interactive: {
    type: "button";
    body: {
      text: string;
    };
    action: {
      buttons: Array<{
        type: "reply";
        reply: {
          id: string;
          title: string;
        };
      }>;
    };
  };
};

export type WhatsAppListInteractivePreview = {
  type: "interactive";
  interactive: {
    type: "list";
    body: {
      text: string;
    };
    action: {
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };
  };
};
