import type { ProductContext } from "./product-context.types";
import type { SellerConfig } from "./seller-config.types";
import type { RequiredOrderField } from "./required-fields.types";

type RequiredFieldsInput = {
  sellerConfig: SellerConfig;
  productContext: ProductContext;
};

function hasCollectedValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return Boolean(value.trim());
  }

  return true;
}

function sortRequiredFields(fields: RequiredOrderField[]): RequiredOrderField[] {
  return [...fields].sort((left, right) => {
    if (left.askOrder !== right.askOrder) {
      return left.askOrder - right.askOrder;
    }

    if (left.source !== right.source) {
      return left.source === "productOption" ? -1 : 1;
    }

    return left.key.localeCompare(right.key);
  });
}

export class RequiredFieldsService {
  getOrderFields(input: RequiredFieldsInput): RequiredOrderField[] {
    const fields = new Map<string, RequiredOrderField>();

    input.sellerConfig.customerFields
      .filter((field) => field.enabled || field.requirement === "DISABLED")
      .forEach((field, index) => {
        const requirement = field.requirement || (field.enabled
          ? field.required
            ? "REQUIRED"
            : "OPTIONAL"
          : "DISABLED");

        fields.set(field.key, {
          key: field.key,
          label: field.label,
          prompt: field.prompt,
          required: field.required,
          enabled: field.enabled,
          source: "customerField",
          askOrder: field.askOrder ?? index + 1,
          minValue: field.minValue,
          maxValue: field.maxValue,
          defaultValue: field.defaultValue,
          requirement,
          captureMode: field.captureMode,
          semanticType: field.semanticType,
          aliases: field.aliases,
          allowMultipleMessages: field.allowMultipleMessages,
          askPolicy: field.askPolicy,
          condition: field.condition,
        });
      });

    input.productContext.optionGroups
      .forEach((group, index) => {
        if (fields.has(group.key)) {
          return;
        }

        fields.set(group.key, {
          key: group.key,
          label: group.label,
          prompt: group.prompt,
          required: group.required,
          enabled: true,
          source: "productOption",
          askOrder: group.askOrder ?? index + 1,
          display: group.display,
          options: [...group.options],
          requirement: group.requirement || (group.required ? "REQUIRED" : "OPTIONAL"),
          captureMode: group.captureMode || "CONFIGURED_ENUM",
          semanticType: group.semanticType,
          aliases: group.aliases,
          allowMultipleMessages: group.allowMultipleMessages,
          askPolicy: group.askPolicy,
          condition: group.condition,
        });
      });

    return sortRequiredFields(Array.from(fields.values()));
  }

  getRequiredOrderFields(input: RequiredFieldsInput): RequiredOrderField[] {
    return this.getOrderFields(input).filter(
      (field) => {
        const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");
        return field.enabled && requirement !== "DISABLED" && requirement !== "OPTIONAL";
      },
    );
  }

  getMissingRequiredFields(input: {
    requiredFields: RequiredOrderField[];
    collected: Record<string, unknown>;
  }): RequiredOrderField[] {
    return input.requiredFields.filter(
      (field) => !hasCollectedValue(input.collected[field.key]),
    );
  }

  getCollectedRequiredFields(input: {
    requiredFields: RequiredOrderField[];
    collected: Record<string, unknown>;
  }): RequiredOrderField[] {
    return input.requiredFields.filter((field) =>
      hasCollectedValue(input.collected[field.key]),
    );
  }
}

export const requiredFieldsService = new RequiredFieldsService();
