export type LanguageStyle = "darija" | "arabic" | "french" | "mixed";

export type DisplayMode = "buttons" | "list" | "text" | "auto";

export type CustomerFieldKey =
  | "fullName"
  | "phone"
  | "city"
  | "address"
  | "quantity"
  | string;

export type CustomerFieldConfig = {
  key: CustomerFieldKey;
  label: string;
  required: boolean;
  enabled: boolean;
  askOrder?: number;
};

export type SellerConfig = {
  sellerId: string;
  businessName: string;
  languageStyle: LanguageStyle;
  showPriceOnFirstReply: boolean;
  delivery: {
    enabled: boolean;
    free: boolean;
    text: string;
    deliveryPrice?: number;
    paymentOnDelivery: boolean;
    paymentText: string;
  };
  customerFields: CustomerFieldConfig[];
  interactive: {
    firstReplyMode: DisplayMode;
    optionDisplayMode: DisplayMode;
    infoMenuDisplayMode: DisplayMode;
  };
  receipt: {
    enabled: boolean;
    showLogo?: boolean;
    footerText?: string;
  };
  ai: {
    mode: "direct" | "hybrid" | "ai";
    naturalReplyEnabled: boolean;
  };
};
