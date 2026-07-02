import type { ProductImage } from "./product-context.types";

export type AgentActionType = "send_product_images";

export interface SendProductImagesAction {
  type: "send_product_images";
  reason: "customer_requested_images" | "sales_support";
  images: ProductImage[];
}

export type AgentAction = SendProductImagesAction;

export interface AgentResult {
  reply: string;
  actions: AgentAction[];
  source: "direct" | "ai_fallback";
}
