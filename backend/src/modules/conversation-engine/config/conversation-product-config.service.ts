import type { ProductContext } from "../../agent/config/product-context.types";
import type { RequiredOrderField } from "../../agent/config/required-fields.types";
import type { ResolvedConversationConfig } from "./conversation-config.types";
import type { ConversationOptionConfig } from "./conversation-config.types";

function baseOptions(productContext: ProductContext): ConversationOptionConfig[] {
  return productContext.optionGroups.map((group, optionIndex) => ({
    key: group.key,
    label: group.label,
    enabled: true,
    requirement: group.required ? "required" : "optional",
    order: group.askOrder ?? optionIndex,
    inputType: group.display,
    promptMessageKey: (group.promptMessageKey as ConversationOptionConfig["promptMessageKey"] | undefined)
      || (group.key === "size" ? "order.first_size_prompt" : "order.first_option_prompt"),
    values: group.valueConfigurations?.length
      ? group.valueConfigurations.map((value) => ({ ...value }))
      : group.options.map((canonicalValue, order) => ({
          key: canonicalValue,
          canonicalValue,
          label: canonicalValue,
          enabled: true,
          available: true,
          order,
        })),
    ...(group.presentation ? { presentation: { ...group.presentation } } : {}),
  }));
}

export function withConversationProductDefaults(
  config: ResolvedConversationConfig,
  productContext: ProductContext,
): ResolvedConversationConfig {
  return {
    ...config,
    productWording: config.productWording || {
      fullName: productContext.name,
      conversationalName: productContext.conversationalName || productContext.name,
      singularName: productContext.singularName || productContext.conversationalName || productContext.name,
      pluralName: productContext.pluralName || productContext.name,
    },
    options: config.optionsExplicitlyConfigured ? config.options : baseOptions(productContext),
  };
}

/** Applies resolved presentation/product-option configuration to a detached runtime product context. */
export function applyResolvedConversationProductConfig(
  productContext: ProductContext,
  config: ResolvedConversationConfig,
): ProductContext {
  const wording = config.productWording;
  const optionGroups = config.optionsExplicitlyConfigured
    ? config.options
        .filter((option) => option.enabled && option.requirement !== "disabled")
        .map((option) => ({
          key: option.key,
          label: option.label,
          required: option.requirement === "required",
          requirement: option.requirement === "required" ? "REQUIRED" as const : "OPTIONAL" as const,
          options: option.values
            .filter((value) => value.enabled && value.available)
            .sort((left, right) => left.order - right.order)
            .map((value) => value.canonicalValue),
          valueConfigurations: option.values.map((value) => ({ ...value })),
          display: option.inputType,
          askOrder: option.order,
          captureMode: option.inputType === "text" ? "OPEN_TEXT" as const : "CONFIGURED_ENUM" as const,
          promptMessageKey: option.promptMessageKey,
          presentation: option.presentation ? { ...option.presentation } : undefined,
        }))
    : productContext.optionGroups.map((group) => ({ ...group, options: [...group.options] }));
  return {
    ...productContext,
    ...(wording?.fullName ? { name: wording.fullName } : {}),
    ...(wording?.conversationalName ? { conversationalName: wording.conversationalName } : {}),
    ...(wording?.singularName ? { singularName: wording.singularName } : {}),
    ...(wording?.pluralName ? { pluralName: wording.pluralName } : {}),
    optionGroups,
  };
}

export function resolveConfiguredOptionCanonicalValue(
  field: RequiredOrderField,
  selectionKey: string,
): string | undefined {
  const configured = field.valueConfigurations?.find(
    (value) => value.key === selectionKey && value.enabled && value.available,
  );
  if (field.valueConfigurations?.length) return configured?.canonicalValue;
  return field.options?.includes(selectionKey) ? selectionKey : undefined;
}
