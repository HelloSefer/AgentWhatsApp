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
    if (left.source !== right.source) {
      return left.source === "customerField" ? -1 : 1;
    }

    if (left.askOrder !== right.askOrder) {
      return left.askOrder - right.askOrder;
    }

    return left.key.localeCompare(right.key);
  });
}

export class RequiredFieldsService {
  getRequiredOrderFields(input: RequiredFieldsInput): RequiredOrderField[] {
    const fields = new Map<string, RequiredOrderField>();

    input.sellerConfig.customerFields
      .filter((field) => field.enabled && field.required)
      .forEach((field, index) => {
        fields.set(field.key, {
          key: field.key,
          label: field.label,
          required: field.required,
          enabled: field.enabled,
          source: "customerField",
          askOrder: field.askOrder ?? index + 1,
        });
      });

    input.productContext.optionGroups
      .filter((group) => group.required)
      .forEach((group, index) => {
        if (fields.has(group.key)) {
          return;
        }

        fields.set(group.key, {
          key: group.key,
          label: group.label,
          required: group.required,
          enabled: true,
          source: "productOption",
          askOrder: group.askOrder ?? index + 1,
          display: group.display,
          options: [...group.options],
        });
      });

    return sortRequiredFields(Array.from(fields.values()));
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
