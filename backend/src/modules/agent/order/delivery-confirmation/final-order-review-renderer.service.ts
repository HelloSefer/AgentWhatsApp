import type { OrderConfirmationPresentation } from "../../reply/reply-renderer.types";
import type { ProductContext } from "../../config/product-context.types";
import type { FinalOrderReview } from "./delivery-confirmation.types";
import { renderCheckoutReview } from "../../../conversation-engine/adapters/checkout-conversation.adapter";

/** Compatibility boundary for existing checkout callers. */
export function renderFinalOrderReview(
  review: FinalOrderReview,
  productContext?: Partial<Pick<ProductContext, "name" | "conversationalName" | "singularName" | "pluralName">>,
): {
  text: string;
  confirmationText: string;
  fallbackText: string;
  presentation: OrderConfirmationPresentation;
} {
  return renderCheckoutReview(review, productContext);
}
