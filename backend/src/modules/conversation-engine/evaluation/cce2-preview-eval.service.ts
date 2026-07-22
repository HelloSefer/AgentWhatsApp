import { AR_MA_MESSAGES } from "../locales/ar-MA";
import { previewConversationConfiguration } from "../preview/conversation-config-preview.service";
import type { Cce2EvalCase } from "./cce2-eval.types";
import { cce2Report, check } from "./cce2-eval.types";

export function evaluateCce2Preview() {
  const cases: Cce2EvalCase[] = [];
  const externalState = { cart: { items: [{ id: "immutable" }] }, stage: "CART_REVIEW" };
  const before = JSON.stringify(externalState);
  const preview = previewConversationConfiguration({
    sellerId: "seller_demo_sandals",
    productId: "prod_demo_sandal_001",
    productOverride: {
      schemaVersion: 1,
      messages: { "first_entry.commercial_intro": "مرحبا من المعاينة" },
      labels: { "first_entry.order_now": "دير الطلب" },
      lists: [{
        key: "information_menu",
        enabled: true,
        bodyMessageKey: "information.menu_opening",
        openingButtonLabel: "اختار",
        title: "المعلومات",
        sections: [{
          key: "main",
          title: "المنتج",
          enabled: true,
          order: 1,
          rows: [
            { key: "price", label: "الثمن", description: "شوف الثمن", enabled: true, available: true, order: 1 },
            { key: "hidden", label: "مخفي", enabled: false, available: true, order: 2 },
          ],
        }],
      }],
    },
    messageKey: "first_entry.commercial_intro",
    listKey: "information_menu",
  });
  check(cases, "preview renders supplied message without saving", preview.renderedMessage === "مرحبا من المعاينة" && preview.persisted === false);
  check(cases, "preview renders configured list data", preview.presentation?.interactionType === "list" && preview.presentation.rows?.[0]?.label === "الثمن");
  check(cases, "configured list section title survives presentation", preview.presentation?.sections?.[0]?.title === "المنتج");
  check(cases, "disabled configured list row is omitted", preview.presentation?.rows?.length === 1);
  check(cases, "preview reports no runtime state mutation", preview.stateMutation === false && JSON.stringify(externalState) === before);
  check(cases, "preview never performs a live send", preview.liveSend === false);

  const invalid = previewConversationConfiguration({
    sellerId: "seller_demo_sandals",
    productOverride: {
      schemaVersion: 1,
      messages: { "first_entry.product_with_price": "{{price}}" },
    },
    messageKey: "first_entry.product_with_price",
    variables: { productFullName: "منتج", price: "100 درهم" },
  });
  check(cases, "invalid preview field uses ar-MA fallback", invalid.renderedMessage === "منتج متوفرة دابا بـ100 درهم،");
  check(cases, "preview exposes structured fallback warning", Boolean(invalid.validation.product?.fallbackFields.length));

  const dtoText = JSON.stringify(preview.effectiveConfig);
  check(cases, "future frontend DTO exposes schema and editable contracts", preview.effectiveConfig.schemaVersion === 1 && preview.effectiveConfig.locale === "ar-MA" && preview.effectiveConfig.safeOutcomeChoices.domainActionKeys.length > 0);
  check(cases, "safe DTO excludes transport credentials and executable services", !/accessToken|graph\.facebook|serviceName|methodName|javascript/i.test(dtoText));
  check(cases, "safe DTO does not expose generated action IDs", !/cart_item_option:|conversation_list:/i.test(dtoText));

  const defaults = previewConversationConfiguration({
    sellerId: "seller_demo_sandals",
    messageKey: "first_entry.commercial_intro",
  });
  check(cases, "default CCE-1 output remains unchanged", defaults.renderedMessage === AR_MA_MESSAGES["first_entry.commercial_intro"]);

  const optionless = previewConversationConfiguration({
    sellerId: "seller_demo_sandals",
    productOverride: { schemaVersion: 1, options: [] },
    messageKey: "order.ready_for_review",
  });
  check(cases, "option-less preview never creates an empty list", optionless.effectiveConfig.options.length === 0 && optionless.presentation === undefined);

  return cce2Report("CCE-2 preview", cases);
}
