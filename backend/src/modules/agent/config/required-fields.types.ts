import type { DisplayMode } from "./seller-config.types";

export type RequiredFieldSource = "customerField" | "productOption";

export type RequiredOrderField = {
  key: string;
  label: string;
  prompt?: string;
  required: boolean;
  enabled: boolean;
  source: RequiredFieldSource;
  askOrder: number;
  display?: DisplayMode;
  options?: string[];
};
