import type { ProductContext } from "../../agent/config/product-context.types";
import { requiredFieldsService } from "../../agent/config/required-fields.service";
import { sellerConfigService } from "../../agent/config/seller-config.service";
import { buildConfiguredOptionPresentation } from "../interactive/dynamic-option-presentation.service";
import { ConversationConfigResolver } from "../config/conversation-config-runtime.service";
import { InMemoryConversationConfigProvider } from "../config/in-memory-conversation-config.provider";
import { applyResolvedConversationProductConfig, resolveConfiguredOptionCanonicalValue, withConversationProductDefaults } from "../config/conversation-product-config.service";
import type { ConversationOptionConfig } from "../config/conversation-config.types";
import type { Cce2EvalCase } from "./cce2-eval.types";
import { cce2Report, check } from "./cce2-eval.types";

function configuredOption(input: {
  key: string;
  label: string;
  values: Array<{ key: string; canonicalValue: string; label: string; description?: string; enabled?: boolean; available?: boolean; order: number }>;
  order?: number;
  inputType?: "buttons" | "list" | "text" | "auto";
}): ConversationOptionConfig {
  return {
    key: input.key,
    label: input.label,
    enabled: true,
    requirement: "required",
    order: input.order || 1,
    inputType: input.inputType || "list",
    promptMessageKey: "order.first_option_prompt",
    values: input.values.map((value) => ({ enabled: true, available: true, ...value })),
    presentation: { title: input.label, buttonLabel: "اختار", currentValueMarker: "الحالي" },
  };
}

function resolved(options: ConversationOptionConfig[]) {
  const provider = new InMemoryConversationConfigProvider({
    productOverrides: {
      "seller_demo_sandals::dynamic": { schemaVersion: 1, options },
    },
  });
  return new ConversationConfigResolver(provider).resolve({ sellerId: "seller_demo_sandals", productId: "dynamic" });
}

export function evaluateCce2DynamicOptions() {
  const cases: Cce2EvalCase[] = [];
  const numeric = configuredOption({
    key: "shoe_size",
    label: "المقاس",
    values: [36, 37, 38, 39, 40].map((size, order) => ({ key: `size_${size}`, canonicalValue: String(size), label: String(size), order })),
  });
  const numericConfig = resolved([numeric]);
  const numericPresentation = buildConfiguredOptionPresentation({ option: numericConfig.options[0], config: numericConfig });
  check(cases, "numeric sizes are built from configuration", numericPresentation.rows?.map((row) => row.label).join(",") === "36,37,38,39,40");
  check(cases, "stable hidden value key is used in action id", numericPresentation.rows?.[2]?.id === "cart_item_option:shoe_size:size_38");

  const alpha = configuredOption({
    key: "clothing_size",
    label: "المقاس",
    values: ["S", "M", "L", "XL", "XXL"].map((size, order) => ({ key: `size_${size.toLowerCase()}`, canonicalValue: size, label: size, order })),
  });
  const alphaPresentation = buildConfiguredOptionPresentation({ option: resolved([alpha]).options[0], config: resolved([alpha]) });
  check(cases, "S through XXL values require no runtime code changes", alphaPresentation.rows?.some((row) => row.label === "XXL") === true);

  const reordered = configuredOption({
    key: "storage",
    label: "السعة",
    values: [
      { key: "storage_512", canonicalValue: "512GB", label: "512GB", order: 3 },
      { key: "storage_128", canonicalValue: "128GB", label: "128GB", order: 1 },
      { key: "storage_256", canonicalValue: "256GB", label: "256GB", description: "الخيار المتوسط", order: 2 },
      { key: "storage_disabled", canonicalValue: "1TB", label: "1TB", enabled: false, order: 4 },
      { key: "storage_unavailable", canonicalValue: "64GB", label: "64GB", available: false, order: 0 },
    ],
  });
  const reorderedConfig = resolved([reordered]);
  const reorderedPresentation = buildConfiguredOptionPresentation({ option: reorderedConfig.options[0], config: reorderedConfig });
  check(cases, "configured value ordering is respected", reorderedPresentation.rows?.map((row) => row.label).join(",") === "128GB,256GB,512GB");
  check(cases, "disabled value is not selectable", !reorderedPresentation.rows?.some((row) => row.label === "1TB"));
  check(cases, "unavailable value is not selectable", !reorderedPresentation.rows?.some((row) => row.label === "64GB"));
  check(cases, "custom row description is rendered", reorderedPresentation.rows?.find((row) => row.label === "256GB")?.description === "الخيار المتوسط");
  check(cases, "non-size option is fully supported", reorderedPresentation.metadata?.optionKey === "storage");

  const flavor = configuredOption({ key: "flavor", label: "النكهة", values: [{ key: "mint", canonicalValue: "mint", label: "نعناع", order: 1 }] });
  const pack = configuredOption({ key: "pack", label: "الحزمة", order: 3, values: [{ key: "pack_two", canonicalValue: "2", label: "جوج", order: 1 }] });
  const material = configuredOption({ key: "material", label: "الخامة", order: 2, values: [{ key: "cotton", canonicalValue: "cotton", label: "قطن", order: 1 }] });
  const many = resolved([pack, flavor, material]);
  check(cases, "more than two options are ordered dynamically", many.options.map((option) => option.key).join(",") === "flavor,material,pack");

  const optionless = resolved([]);
  check(cases, "explicit option-less product stays option-less", optionless.optionsExplicitlyConfigured && optionless.options.length === 0);

  const current = buildConfiguredOptionPresentation({ option: numeric, config: numericConfig, currentValueKey: "size_37" });
  check(cases, "current value marker is configuration-driven", current.rows?.filter((row) => row.current).length === 1 && current.rows?.[1]?.label.includes("الحالي"));

  const changedLabel = { ...numeric, values: numeric.values.map((value) => value.key === "size_38" ? { ...value, label: "ثمانية وثلاثون" } : value) };
  const changedPresentation = buildConfiguredOptionPresentation({ option: changedLabel, config: resolved([changedLabel]) });
  check(cases, "visible label changes without changing hidden value key", changedPresentation.rows?.[2]?.id === "cart_item_option:shoe_size:size_38" && changedPresentation.rows?.[2]?.label === "ثمانية وثلاثون");

  const buttonOption = configuredOption({
    key: "finish",
    label: "اللمسة",
    inputType: "buttons",
    values: [{ key: "finish_matte", canonicalValue: "matte", label: "مطفي مخصص", order: 1 }],
  });
  const buttonPresentation = buildConfiguredOptionPresentation({ option: buttonOption, config: resolved([buttonOption]) });
  check(cases, "custom button label keeps protected action identity", buttonPresentation.actions?.[0]?.label === "مطفي مخصص" && buttonPresentation.actions?.[0]?.id === "cart_item_option:finish:finish_matte");

  const product: ProductContext = {
    sellerId: "seller_demo_sandals", productId: "dynamic", name: "منتج", price: 10, currency: "MAD", active: true,
    images: [], benefits: [], optionGroups: [], infoMenu: [], stock: { enabled: false, status: "AVAILABLE" },
  };
  const effective = withConversationProductDefaults(numericConfig, product);
  const runtimeProduct = applyResolvedConversationProductConfig(product, effective);
  const fields = requiredFieldsService.getOrderFields({ sellerConfig: sellerConfigService.getSellerConfig("seller_demo_sandals"), productContext: runtimeProduct });
  const field = fields.find((candidate) => candidate.key === "shoe_size")!;
  check(cases, "stable key resolves to authoritative canonical value", resolveConfiguredOptionCanonicalValue(field, "size_38") === "38");
  check(cases, "removed stale value key cannot be newly resolved", resolveConfiguredOptionCanonicalValue(field, "size_99") === undefined);

  return cce2Report("CCE-2 dynamic options and lists", cases);
}
