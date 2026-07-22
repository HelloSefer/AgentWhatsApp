import type { DisplayMode } from "./seller-config.types";
import type {
  OptionalFieldAskPolicy,
  OrderFieldCaptureMode,
  OrderFieldCondition,
  OrderFieldRequirement,
} from "./seller-config.types";

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
  valueConfigurations?: Array<{
    key: string;
    canonicalValue: string;
    label: string;
    description?: string;
    enabled: boolean;
    available: boolean;
    order: number;
  }>;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number | string;
  requirement?: OrderFieldRequirement;
  captureMode?: OrderFieldCaptureMode;
  semanticType?: string;
  aliases?: string[];
  allowMultipleMessages?: boolean;
  askPolicy?: OptionalFieldAskPolicy;
  condition?: OrderFieldCondition;
  promptMessageKey?: string;
  presentation?: {
    title?: string;
    sectionTitle?: string;
    buttonLabel?: string;
    fallbackText?: string;
    currentValueMarker?: string;
  };
};
