export type LanguageStyle = "darija" | "arabic" | "french" | "mixed";

export type DisplayMode = "buttons" | "list" | "text" | "auto";

export type GreetingStyle = "short" | "friendly" | "professional";

export type FirstEntryCtaMode =
  | "order_or_info"
  | "order_only"
  | "info_only"
  | "none";

export type DeliveryAvailability =
  | "all_cities"
  | "selected_cities"
  | "excluded_cities"
  | "not_available"
  | "not_mentioned";

export type DeliveryWordingStyle = "short" | "clear" | "professional";

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
  prompt?: string;
  required: boolean;
  enabled: boolean;
  askOrder?: number;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number | string;
};

export type FirstEntryPolicy = {
  enabled: boolean;
  showProductName: boolean;
  showPrice: boolean;
  showDelivery: boolean;
  showPayment: boolean;
  showPromotion?: boolean;
  showTrustLine?: boolean;
  ctaMode: FirstEntryCtaMode;
  greetingStyle: GreetingStyle;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;
};

export type DeliveryPolicy = {
  enabled: boolean;
  availability: DeliveryAvailability;
  isFree?: boolean;
  deliveryPrice?: number;
  currency?: "MAD";
  cities?: string[];
  excludedCities?: string[];
  wordingStyle?: DeliveryWordingStyle;
};

export type SellerConfig = {
  sellerId: string;
  businessName: string;
  languageStyle: LanguageStyle;
  showPriceOnFirstReply: boolean;
  firstEntryPolicy: FirstEntryPolicy;
  deliveryPolicy: DeliveryPolicy;
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
