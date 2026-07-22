import { AR_MA_LABELS, AR_MA_MESSAGES } from "../locales/ar-MA";
import { ConversationConfigResolver } from "../config/conversation-config-runtime.service";
import { InMemoryConversationConfigProvider } from "../config/in-memory-conversation-config.provider";
import { runWithConversationConfig } from "../config/conversation-config-context.service";
import { renderConversationLabel, renderConversationMessage } from "../rendering/conversation-renderer.service";
import type { Cce2EvalCase } from "./cce2-eval.types";
import { cce2Report, check } from "./cce2-eval.types";

export function evaluateCce2OverrideResolution() {
  const cases: Cce2EvalCase[] = [];
  const provider = new InMemoryConversationConfigProvider({
    sellerOverrides: {
      seller_one: {
        schemaVersion: 1,
        messages: { "first_entry.commercial_intro": "ترحيب البائع" },
        labels: { "first_entry.order_now": "طلب البائع" },
        productWording: { conversationalName: "منتوج البائع" },
      },
    },
    productOverrides: {
      "seller_one::product_one": {
        schemaVersion: 1,
        messages: { "first_entry.commercial_intro": "ترحيب المنتج" },
        labels: { "first_entry.order_now": "طلب المنتج" },
        productWording: { fullName: "اسم المنتج", conversationalName: "المنتج", singularName: "منتج", pluralName: "منتجات" },
      },
      "seller_one::invalid_product": {
        schemaVersion: 1,
        messages: { "first_entry.product_with_price": "قيمة غير صالحة {{price}}" },
      },
    },
  });
  const resolver = new ConversationConfigResolver(provider);
  const defaults = resolver.resolve({ sellerId: "unknown" });
  check(cases, "default ar-MA resolution", defaults.locale === "ar-MA" && defaults.messages["first_entry.commercial_intro"] === AR_MA_MESSAGES["first_entry.commercial_intro"]);

  const seller = resolver.resolve({ sellerId: "seller_one" });
  check(cases, "seller override is applied", seller.messages["first_entry.commercial_intro"] === "ترحيب البائع" && seller.labels["first_entry.order_now"] === "طلب البائع");

  const product = resolver.resolve({ sellerId: "seller_one", productId: "product_one" });
  check(cases, "product override wins over seller override", product.messages["first_entry.commercial_intro"] === "ترحيب المنتج" && product.labels["first_entry.order_now"] === "طلب المنتج");
  check(cases, "product wording resolves dynamically", product.productWording?.pluralName === "منتجات");

  const invalid = resolver.resolve({ sellerId: "seller_one", productId: "invalid_product" });
  check(cases, "invalid product field falls back to nearest seller value", invalid.messages["first_entry.commercial_intro"] === "ترحيب البائع");
  check(cases, "invalid override reports structured fallback", invalid.fallbackFields.some((path) => path.includes("first_entry.product_with_price")));

  const rendered = runWithConversationConfig(product, () => ({
    message: renderConversationMessage("first_entry.commercial_intro"),
    label: renderConversationLabel("first_entry.order_now"),
  }));
  check(cases, "active renderer consumes resolved request context", rendered.message === "ترحيب المنتج" && rendered.label === "طلب المنتج");

  const after = renderConversationMessage("first_entry.commercial_intro");
  check(cases, "request configuration does not leak outside its context", after === AR_MA_MESSAGES["first_entry.commercial_intro"]);
  check(cases, "default labels remain byte-for-byte unchanged", defaults.labels["first_entry.order_now"] === AR_MA_LABELS["first_entry.order_now"]);

  return cce2Report("CCE-2 override resolution", cases);
}
