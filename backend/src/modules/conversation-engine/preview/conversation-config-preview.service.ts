import type { ProductContext } from "../../agent/config/product-context.types";
import { productContextService } from "../../agent/config/product-context.service";
import type { ConversationTemplateValue } from "../contracts/conversation-presentation.types";
import { isRegisteredConversationMessageKey } from "../config/conversation-safe-outcome.registry";
import { ConversationConfigResolver } from "../config/conversation-config-runtime.service";
import { conversationConfigValidator } from "../config/conversation-config-validator.service";
import { toConversationConfigEditorDto } from "../config/conversation-config.dto";
import type { ConversationConfigurationOverride } from "../config/conversation-config.types";
import { InMemoryConversationConfigProvider, inMemoryConversationConfigProvider } from "../config/in-memory-conversation-config.provider";
import { withConversationProductDefaults } from "../config/conversation-product-config.service";
import { runWithConversationConfig } from "../config/conversation-config-context.service";
import { buildConfiguredListPresentation, buildConfiguredOptionPresentation } from "../interactive/dynamic-option-presentation.service";
import { renderConversationMessage } from "../rendering/conversation-renderer.service";

function scopeKey(sellerId: string, productId: string): string {
  return `${sellerId}::${productId}`;
}

function demoProduct(sellerId: string, productId?: string): ProductContext {
  return (productId ? productContextService.getProductContextById(productId) : undefined)
    || productContextService.getActiveProductContext(sellerId);
}

function safeVariables(value: unknown): Readonly<Record<string, ConversationTemplateValue>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry))
      .map(([key, entry]) => [key, entry as string | number | boolean]),
  );
}

export function validateConversationConfigurationPayload(payload: unknown) {
  return conversationConfigValidator.validate(payload);
}

export function getEffectiveConversationConfiguration(input: {
  sellerId: string;
  productId?: string;
}) {
  const product = demoProduct(input.sellerId, input.productId);
  const resolved = withConversationProductDefaults(
    new ConversationConfigResolver(inMemoryConversationConfigProvider).resolve({
      sellerId: input.sellerId,
      productId: product.productId,
    }),
    product,
  );
  return {
    scope: { sellerId: input.sellerId, productId: product.productId },
    config: toConversationConfigEditorDto(resolved),
  };
}

/** Stateless preview. Supplied configuration is resolved in an isolated provider and never persisted. */
export function previewConversationConfiguration(input: {
  sellerId: string;
  productId?: string;
  sellerOverride?: unknown;
  productOverride?: unknown;
  messageKey?: unknown;
  variables?: unknown;
  optionKey?: unknown;
  currentValueKey?: unknown;
  listKey?: unknown;
}) {
  const product = demoProduct(input.sellerId, input.productId);
  const sellerValidation = input.sellerOverride === undefined
    ? undefined
    : conversationConfigValidator.validate(input.sellerOverride, "seller");
  const productValidation = input.productOverride === undefined
    ? undefined
    : conversationConfigValidator.validate(input.productOverride, "product");
  const provider = new InMemoryConversationConfigProvider({
    sellerOverrides: sellerValidation?.normalizedConfig
      ? { [input.sellerId]: sellerValidation.normalizedConfig }
      : undefined,
    productOverrides: productValidation?.normalizedConfig
      ? { [scopeKey(input.sellerId, product.productId)]: productValidation.normalizedConfig }
      : undefined,
  });
  const resolved = withConversationProductDefaults(
    new ConversationConfigResolver(provider).resolve({ sellerId: input.sellerId, productId: product.productId }),
    product,
  );
  const optionKey = typeof input.optionKey === "string" ? input.optionKey.trim() : "";
  const listKey = typeof input.listKey === "string" ? input.listKey.trim() : "";
  const messageKey = isRegisteredConversationMessageKey(input.messageKey)
    ? input.messageKey
    : "error.recovery";
  const option = optionKey ? resolved.options.find((candidate) => candidate.key === optionKey) : undefined;
  const list = listKey ? resolved.lists.find((candidate) => candidate.key === listKey) : undefined;
  const presentation = option
    ? buildConfiguredOptionPresentation({
        option,
        config: resolved,
        currentValueKey: typeof input.currentValueKey === "string" ? input.currentValueKey : undefined,
      })
    : list
      ? buildConfiguredListPresentation({ list, config: resolved })
      : undefined;
  const renderedMessage = runWithConversationConfig(resolved, () =>
    renderConversationMessage(messageKey, safeVariables(input.variables)),
  );
  return {
    scope: { sellerId: input.sellerId, productId: product.productId },
    validation: {
      seller: sellerValidation,
      product: productValidation,
    },
    renderedMessage,
    ...(presentation ? { presentation } : {}),
    effectiveConfig: toConversationConfigEditorDto(resolved),
    warnings: resolved.warnings,
    fallbackFields: resolved.fallbackFields,
    stateMutation: false,
    persisted: false,
    liveSend: false,
  };
}
