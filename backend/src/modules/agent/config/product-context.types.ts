import type {
  DisplayMode,
  OptionalFieldAskPolicy,
  OrderFieldCaptureMode,
  OrderFieldCondition,
  OrderFieldRequirement,
} from "./seller-config.types";
import type { ProductOfferConfig } from "./offers/offer.types";

export type ProductOptionGroup = {
  key: string;
  label: string;
  prompt?: string;
  required: boolean;
  options: string[];
  display: DisplayMode;
  askOrder?: number;
  requirement?: OrderFieldRequirement;
  captureMode?: OrderFieldCaptureMode;
  semanticType?: string;
  aliases?: string[];
  allowMultipleMessages?: boolean;
  askPolicy?: OptionalFieldAskPolicy;
  condition?: OrderFieldCondition;
};

export type ProductInfoMenuItem =
  | "price"
  | "colors"
  | "sizes"
  | "types"
  | "pictures"
  | "quality"
  | "availability"
  | "promotion"
  | "delivery"
  | "payment"
  | "usage"
  | "benefits"
  | "warranty"
  | string;

export type ProductContext = {
  sellerId: string;
  productId: string;
  name: string;
  /** Short natural name used only in customer-facing conversational copy. */
  conversationalName?: string;
  description?: string;
  price: number;
  oldPrice?: number;
  currency: "MAD";
  /** Commercial configuration only. Offer selection and pricing are handled in later phases. */
  offers?: ProductOfferConfig[];
  active: boolean;
  images: string[];
  benefits: string[];
  optionGroups: ProductOptionGroup[];
  infoMenu: ProductInfoMenuItem[];
  stock: {
    enabled: boolean;
    status: "AVAILABLE" | "LIMITED" | "OUT_OF_STOCK";
    text?: string;
  };
  safety?: {
    medicalDisclaimer?: boolean;
    avoidMedicalClaims?: boolean;
  };
};
