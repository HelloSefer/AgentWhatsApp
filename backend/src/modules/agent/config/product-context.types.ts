import type { DisplayMode } from "./seller-config.types";

export type ProductOptionGroup = {
  key: string;
  label: string;
  required: boolean;
  options: string[];
  display: DisplayMode;
  askOrder?: number;
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
  description?: string;
  price: number;
  oldPrice?: number;
  currency: "MAD";
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
