import type { ProductContext } from "../product-context.types";
import {
  attributeDefinitions,
  type AttributeDefinition,
} from "./attribute-definitions";
import {
  includesAny,
  normalizeComparable,
  normalizeText,
} from "./text-normalization";

function findFaqAnswer(
  definition: AttributeDefinition,
  productContext: ProductContext,
): string | null {
  const faqs = productContext.faqs || [];

  for (const faq of faqs) {
    const normalizedQuestion = normalizeText(faq.question);
    const matches = definition.messageKeywords.some((keyword) =>
      normalizedQuestion.includes(normalizeText(keyword)),
    );

    if (matches && faq.answer) {
      return faq.answer;
    }
  }

  return null;
}

function findFeatureValue(
  definition: AttributeDefinition,
  productContext: ProductContext,
): string | null {
  if (!["ram", "storage"].includes(definition.kind)) {
    return null;
  }

  const features = productContext.features || [];
  const matchingFeature = features.find((feature) =>
    definition.messageKeywords.some((keyword) =>
      normalizeText(feature).includes(normalizeText(keyword)),
    ),
  );

  return matchingFeature || null;
}

function findAttributeValue(
  definition: AttributeDefinition,
  productContext: ProductContext,
): string | null {
  if (definition.kind === "warranty" && productContext.warrantyInfo) {
    return productContext.warrantyInfo;
  }

  if (definition.kind === "condition" && productContext.condition) {
    return productContext.condition;
  }

  for (const [key, value] of Object.entries(productContext.attributes || {})) {
    const normalizedKey = normalizeComparable(key);
    const matches = definition.attributeKeys.some((attributeKey) => {
      const normalizedAttributeKey = normalizeComparable(attributeKey);

      return (
        normalizedKey === normalizedAttributeKey ||
        normalizedKey.includes(normalizedAttributeKey) ||
        normalizedAttributeKey.includes(normalizedKey)
      );
    });

    if (matches && value) {
      return value;
    }
  }

  return (
    findFaqAnswer(definition, productContext) ||
    findFeatureValue(definition, productContext)
  );
}

export function getAttributeReply(
  message: string,
  productContext: ProductContext,
): string | null {
  return getAttributeReplyResult(message, productContext)?.reply || null;
}

export function getAttributeReplyResult(
  message: string,
  productContext: ProductContext,
): { reply: string; grounded: boolean } | null {
  const definition = attributeDefinitions.find((attributeDefinition) =>
    includesAny(message, attributeDefinition.messageKeywords),
  );

  if (!definition) {
    return null;
  }

  const value = findAttributeValue(definition, productContext);

  if (!value) {
    return { reply: definition.missingReply, grounded: false };
  }

  const prefix = definition.kind === "longevity" ? "نعم، " : "";

  return {
    reply: `${prefix}${definition.label}: ${value}.`,
    grounded: true,
  };
}
