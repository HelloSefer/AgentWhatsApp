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

export type DeliveryPricingMode = "ALL_FREE" | "FLAT_RATE" | "CITY_RULES";

export type DeliveryPriceRuleType = "FREE" | "PAID" | "UNAVAILABLE";

export type DeliveryPriceRule = {
  id: string;
  type: DeliveryPriceRuleType;
  cityKeys: string[];
  aliases?: string[];
  amount?: number;
  priority?: number;
};

export type DeliveryDefaultRule = {
  id?: string;
  type: DeliveryPriceRuleType;
  amount?: number;
};

export type DeliveryPricingConfig = {
  enabled: boolean;
  mode: DeliveryPricingMode;
  currency: "MAD";
  flatRate?: number;
  rules?: DeliveryPriceRule[];
  defaultRule?: DeliveryDefaultRule;
};

export type CustomerFieldKey =
  | "fullName"
  | "phone"
  | "city"
  | "address"
  | "quantity"
  | string;

export type OrderFieldRequirement =
  | "REQUIRED"
  | "OPTIONAL"
  | "DISABLED"
  | "CONDITIONAL";

export type OrderFieldCaptureMode =
  | "CONFIGURED_ENUM"
  | "OPEN_TEXT"
  | "NUMERIC"
  | "PHONE"
  | "LOCATION"
  | "ADDRESS"
  | "CUSTOM";

export type OptionalFieldAskPolicy =
  | "DO_NOT_ASK"
  | "ASK_ONCE"
  | "ASK_BEFORE_CONFIRMATION";

export type OrderFieldCondition = {
  fieldKey: string;
  equals?: string | number | boolean;
  exists?: boolean;
};

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
  /** Explicit policy; absent values retain the legacy required/enabled behavior. */
  requirement?: OrderFieldRequirement;
  captureMode?: OrderFieldCaptureMode;
  semanticType?: string;
  aliases?: string[];
  allowMultipleMessages?: boolean;
  askPolicy?: OptionalFieldAskPolicy;
  condition?: OrderFieldCondition;
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
  pricing?: DeliveryPricingConfig;
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
    sendAfterConfirmation: boolean;
    showLogo?: boolean;
    footerText?: string;
    locale?: "fr";
    currency?: string;
    paymentMethodLabel?: string;
    branding?: {
      storeName?: string;
      slogan?: string;
      logoUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      phone?: string;
      whatsapp?: string;
      email?: string;
      website?: string;
      address?: string;
      instagram?: string;
      facebook?: string;
      tiktok?: string;
    };
  };
  ai: {
    mode: "direct" | "hybrid" | "ai";
    naturalReplyEnabled: boolean;
  };
};
