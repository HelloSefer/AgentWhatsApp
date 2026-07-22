import type { ConversationProductWording } from "../contracts/product-conversation.types";
import { commonLabel } from "./common-conversation.adapter";

export type ProductWordingSource = Readonly<{
  name?: string;
  productName?: string;
  conversationalName?: string;
  conversationalProductName?: string;
  singularName?: string;
  pluralName?: string;
}>;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveProductConversationWording(
  source: ProductWordingSource,
): ConversationProductWording {
  const fullName = clean(source.name) || clean(source.productName) || commonLabel("common.product");
  const conversationalName = clean(source.conversationalName)
    || clean(source.conversationalProductName)
    || fullName;
  const singularName = clean(source.singularName)
    || conversationalName.replace(/^ال/u, "")
    || fullName;
  const pluralName = clean(source.pluralName) || fullName;
  return { fullName, conversationalName, singularName, pluralName };
}
