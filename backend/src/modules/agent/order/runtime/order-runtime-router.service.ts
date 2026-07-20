import { randomBytes } from "node:crypto";
import { env } from "../../../../config/env";
import { getValkeyClient } from "../../../../infrastructure/valkey/valkey.client";
import { normalizeSellerConfig } from "../../config/first-entry-config.service";
import { renderFirstEntryMessage } from "../../config/first-entry-renderer.service";
import { offerConfigService } from "../../config/offers/offer-config.service";
import { productContextService } from "../../config/product-context.service";
import { requiredFieldsService } from "../../config/required-fields.service";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { sellerConfigService } from "../../config/seller-config.service";
import { prepareConfirmedOrderReceipt } from "../confirmed-order/confirmed-order-preview.service";
import { runCartReviewPreview } from "../cart-review/cart-review-preview.service";
import { runDeliveryConfirmationPreview } from "../delivery-confirmation/delivery-confirmation-preview.service";
import { runItemCollectionPreview } from "../item-collection/preview/item-collection-preview.service";
import { runCartPlanningPreview } from "../planning/preview/cart-planning-preview.service";
import {
  recoveryReply,
  replyFromCartReview,
  replyFromDelivery,
  replyFromItemCollection,
  replyFromPlanning,
  staleActionReply,
  type RuntimeReply,
} from "./order-runtime-reply.service";
import { loadOrderRuntimeSession, saveOrderRuntimeSession } from "./order-runtime-session.service";
import type {
  OrderRuntimeReadiness,
  OrderRuntimeSession,
  OrderRuntimeStage,
  OrderRuntimeTurnInput,
  OrderRuntimeTurnResult,
} from "./order-runtime.types";

export function isGuardedOrderRuntimeAction(message: string): boolean {
  return /^(?:first_entry:order_now|info:order_now|cart_offer:.+|cart_quantity:.+|cart_item_option:.+|cart_item_previous:(?:same|different)|cart_review:.+|cart_review_item:.+|cart_review_item_edit:.+|order_checkout:.+|order_checkout_field:.+)$/.test(message);
}

function isInformationAction(message: string): boolean {
  return /^(?:first_entry:more_info|info:(?:price|sizes|colors|delivery_payment|availability|how_to_order|menu|more_info|continue_order))$/.test(message);
}

function normalizeRuntimeMessage(
  message: string,
  stage: OrderRuntimeStage,
): string {
  return stage === "FIRST_ENTRY" && message === "info:order_now"
    ? "first_entry:order_now"
    : message;
}

function isOrderStartText(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return ["بغيت نكوموندي", "بغيت نكومندي", "بغيت الطلب", "أطلب الآن", "order now", "commande", "order"].some((value) => normalized.includes(value));
}

function runtimeIdentity(input: OrderRuntimeTurnInput, productId: string) {
  return {
    sellerId: input.sellerId,
    customerPhone: input.customerPhone,
    conversationKey: input.conversationKey,
    productId,
  };
}

function stageForCartReview(nextStep: string | undefined): OrderRuntimeStage {
  return nextStep === "RETURN_TO_ITEM_COLLECTION" ? "COLLECTING_ITEM"
    : nextStep === "DELIVERY_COLLECTION_READY" ? "COLLECTING_DELIVERY"
    : nextStep === "SHOW_ITEM_ACTIONS" || nextStep === "ENTER_ITEM_QUANTITY" ? "EDITING_CART_ITEM"
    : "CART_REVIEW";
}

function asTurnResult(input: RuntimeReply & { stage: OrderRuntimeStage; warnings?: readonly string[]; failureCode?: string; confirmedSnapshotId?: string; receiptReady?: boolean; publicOrderCode?: string; receiptArtifact?: OrderRuntimeTurnResult["receiptArtifact"] }): OrderRuntimeTurnResult {
  return {
    handled: true,
    reply: input.text,
    ...(input.replyUi ? { replyUi: input.replyUi } : {}),
    ...(input.orderConfirmationPresentation
      ? { orderConfirmationPresentation: structuredClone(input.orderConfirmationPresentation) }
      : {}),
    stage: input.stage,
    warnings: [...(input.warnings || [])],
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.confirmedSnapshotId ? { confirmedSnapshotId: input.confirmedSnapshotId } : {}),
    ...(input.receiptReady !== undefined ? { receiptReady: input.receiptReady } : {}),
    ...(input.publicOrderCode ? { publicOrderCode: input.publicOrderCode } : {}),
    ...(input.receiptArtifact ? { receiptArtifact: input.receiptArtifact } : {}),
  };
}

function createPublicOrderCode(): string {
  return `CMD-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function getOrderRuntimeReadiness(sellerId: string, activationRequested = false): Promise<OrderRuntimeReadiness> {
  const known = sellerConfigService.hasSellerConfig(sellerId);
  const configured = known ? sellerConfigService.getSellerConfig(sellerId) : undefined;
  const feature = normalizeSellerConfig(configured || sellerConfigService.getSellerConfig("seller_demo_sandals"), undefined).multiItemOrderFlow!;
  const scoped = known && feature.allowedSellerIds?.includes(sellerId) === true;
  let valkeyReady = false;
  try {
    valkeyReady = (await getValkeyClient().ping()) === "PONG";
  } catch (_error) {
    valkeyReady = false;
  }
  const flowEnabled = known && scoped && feature.runtimeMode !== "disabled" && (feature.enabled || activationRequested);
  return {
    flowEnabled,
    runtimeMode: feature.runtimeMode,
    liveDispatchEnabled: env.whatsappCloudReplyButtonsEnabled && env.whatsappInteractiveChoicesEnabled,
    guardedSellerScope: scoped,
    sellerKnown: known,
    valkeyReady,
    ...(!known ? { reason: "unknown_seller" } : !scoped ? { reason: "seller_not_allowlisted" } : !feature.enabled && !activationRequested ? { reason: "feature_disabled" } : {}),
  };
}

async function persist(input: OrderRuntimeTurnInput, runtime: OrderRuntimeSession, fields: RequiredOrderField[]): Promise<void> {
  await saveOrderRuntimeSession({ ...runtimeIdentity(input, runtime.productId), runtime, fields });
}

/**
 * The sole guarded bridge from the agent runtime into Phase 6.3. All domain
 * helpers below are pure preview orchestrators: this boundary owns Valkey I/O.
 */
export async function processGuardedOrderRuntimeTurn(input: OrderRuntimeTurnInput): Promise<OrderRuntimeTurnResult> {
  const readiness = await getOrderRuntimeReadiness(input.sellerId, input.activationRequested === true);
  if (!readiness.flowEnabled || !readiness.valkeyReady) return { handled: false, warnings: [] };

  const sellerConfig = normalizeSellerConfig(sellerConfigService.getSellerConfig(input.sellerId));
  const productContext = productContextService.getActiveProductContext(input.sellerId);
  const fields = requiredFieldsService.getOrderFields({ sellerConfig, productContext });
  const offers = offerConfigService.getConfiguredOffers({ sellerId: input.sellerId, productId: productContext.productId });
  const identity = runtimeIdentity(input, productContext.productId);
  const loaded = await loadOrderRuntimeSession({ ...identity, fields });
  const runtime = loaded.runtime;
  const actionId = input.actionId?.trim() || "";
  const normalizedText = (input.normalizedText ?? input.message).trim();
  const rawMessage = isGuardedOrderRuntimeAction(actionId)
    ? actionId
    : normalizedText;
  const message = normalizeRuntimeMessage(rawMessage, runtime.runtimeStage);
  const now = new Date();

  console.info(JSON.stringify({
    event: "agent.order_runtime.route_requested",
    conversationScope: input.conversationKey.length > 8
      ? `${input.conversationKey.slice(0, 4)}***${input.conversationKey.slice(-4)}`
      : "***",
    sourceType: input.sourceType || "text",
    actionId: isGuardedOrderRuntimeAction(actionId) ? actionId : undefined,
    runtimeStageBefore: runtime.runtimeStage,
  }));

  if (isInformationAction(actionId)) {
    return { handled: false, warnings: [] };
  }

  if (runtime.runtimeStage === "CONFIRMED") {
    return asTurnResult({
      text: "الطلب ديالك تأكد من قبل. شكراً على الثقة ديالك.",
      stage: "CONFIRMED",
      ...(runtime.confirmed?.publicOrderCode
        ? { publicOrderCode: runtime.confirmed.publicOrderCode }
        : {}),
    });
  }
  if (runtime.runtimeStage === "FIRST_ENTRY") {
    if (message === "first_entry:more_info") return { handled: false, warnings: [] };
    if (isGuardedOrderRuntimeAction(rawMessage) && message !== "first_entry:order_now") {
      return asTurnResult({ ...staleActionReply(), stage: runtime.runtimeStage });
    }
    // Real transport conversations keep Phase 1 First Entry and information
    // exploration authoritative until an explicit Order Now action arrives.
    if (input.sourceType && message !== "first_entry:order_now") {
      return { handled: false, warnings: [] };
    }
    if (message !== "first_entry:order_now" && !isOrderStartText(message)) {
      const firstEntry = renderFirstEntryMessage({ sellerConfig, productContext });
      await persist(input, runtime, fields);
      return asTurnResult({ text: firstEntry.text, replyUi: firstEntry.uiHints.replyUi, stage: "FIRST_ENTRY", warnings: firstEntry.warnings });
    }
    const planning = runCartPlanningPreview({ previewEnabled: true, rawActionId: "first_entry:order_now", sellerId: input.sellerId, productContext, offerLookup: offers, cart: runtime.cart, previewPlanningState: runtime.planningState, now });
    runtime.cart = planning.cartAfter;
    runtime.planningState = planning.previewPlanningState;
    runtime.runtimeStage = "PLANNING";
    runtime.lastHandledAction = "first_entry:order_now";
    await persist(input, runtime, fields);
    return asTurnResult({ ...replyFromPlanning(planning), stage: runtime.runtimeStage, warnings: planning.warnings, failureCode: planning.failureCode });
  }

  if (runtime.runtimeStage === "PLANNING") {
    const planning = runCartPlanningPreview({ previewEnabled: true, rawActionId: isGuardedOrderRuntimeAction(message) ? message : undefined, planningText: !isGuardedOrderRuntimeAction(message) ? message : undefined, sellerId: input.sellerId, productContext, offerLookup: offers, cart: runtime.cart, previewPlanningState: runtime.planningState, now });
    if (!planning.handled) return isGuardedOrderRuntimeAction(message) ? asTurnResult({ ...staleActionReply(), stage: runtime.runtimeStage }) : { handled: false, warnings: [] };
    if (!planning.planningResult?.success && planning.failureCode) return asTurnResult({ ...recoveryReply(), stage: runtime.runtimeStage, warnings: planning.warnings, failureCode: planning.failureCode });
    runtime.cart = planning.cartAfter;
    runtime.planningState = planning.previewPlanningState;
    runtime.lastHandledAction = isGuardedOrderRuntimeAction(message) ? message : undefined;
    if (planning.nextStep === "START_ITEM_COLLECTION") {
      const item = runItemCollectionPreview({ previewEnabled: true, sellerId: input.sellerId, productContext, requiredFields: fields, cart: runtime.cart, previewState: runtime.itemCollectionState });
      runtime.cart = item.cartAfter;
      runtime.itemCollectionState = item.previewState;
      runtime.runtimeStage = "COLLECTING_ITEM";
      await persist(input, runtime, fields);
      return asTurnResult({ ...replyFromItemCollection(item), stage: runtime.runtimeStage, warnings: [...planning.warnings, ...item.warnings] });
    }
    await persist(input, runtime, fields);
    return asTurnResult({ ...replyFromPlanning(planning), stage: runtime.runtimeStage, warnings: planning.warnings, failureCode: planning.failureCode });
  }

  if (runtime.runtimeStage === "COLLECTING_ITEM") {
    const item = runItemCollectionPreview({ previewEnabled: true, rawActionId: isGuardedOrderRuntimeAction(message) ? message : undefined, itemCollectionText: !isGuardedOrderRuntimeAction(message) ? message : undefined, sellerId: input.sellerId, productContext, requiredFields: fields, cart: runtime.cart, previewState: runtime.itemCollectionState });
    if (!item.handled) return isGuardedOrderRuntimeAction(message) ? asTurnResult({ ...staleActionReply(), stage: runtime.runtimeStage }) : { handled: false, warnings: [] };
    // A handled item turn is already constrained by the D2 normalizers. Some
    // valid mutations intentionally expose a non-success *next prompt* (for
    // example, quantity is still awaited), so keep the trusted cartAfter and
    // let the presentation describe the next required input.
    runtime.cart = item.cartAfter;
    runtime.itemCollectionState = item.previewState;
    runtime.lastHandledAction = isGuardedOrderRuntimeAction(message) ? message : undefined;
    if (item.nextStep === "CART_REVIEW_READY") {
      const review = runCartReviewPreview({ previewEnabled: true, sellerId: input.sellerId, productContext, requiredFields: fields, offerLookup: offers, cart: runtime.cart, previewState: runtime.cartReviewState, now });
      runtime.cart = review.cartAfter;
      runtime.cartReviewState = review.previewState;
      runtime.runtimeStage = "CART_REVIEW";
      await persist(input, runtime, fields);
      return asTurnResult({ ...replyFromCartReview(review), stage: runtime.runtimeStage, warnings: [...item.warnings, ...review.warnings] });
    }
    await persist(input, runtime, fields);
    return asTurnResult({ ...replyFromItemCollection(item), stage: runtime.runtimeStage, warnings: item.warnings });
  }

  if (runtime.runtimeStage === "CART_REVIEW" || runtime.runtimeStage === "EDITING_CART_ITEM") {
    const review = runCartReviewPreview({ previewEnabled: true, rawActionId: isGuardedOrderRuntimeAction(message) ? message : undefined, cartReviewText: !isGuardedOrderRuntimeAction(message) ? message : undefined, sellerId: input.sellerId, productContext, requiredFields: fields, offerLookup: offers, cart: runtime.cart, previewState: runtime.cartReviewState, cartItemEditPreviewState: runtime.itemEditState, now });
    if (!review.handled) return isGuardedOrderRuntimeAction(message) ? asTurnResult({ ...staleActionReply(), stage: runtime.runtimeStage }) : { handled: false, warnings: [] };
    runtime.cart = review.cartAfter;
    runtime.cartReviewState = review.previewState;
    runtime.itemEditState = review.cartItemEditPreviewState;
    runtime.runtimeStage = stageForCartReview(review.nextStep);
    if (review.nextStep === "DELIVERY_COLLECTION_READY") {
      const delivery = runDeliveryConfirmationPreview({ previewEnabled: true, sellerId: input.sellerId, conversationScopeId: input.conversationKey, productContext, requiredFields: fields, offerLookup: offers, deliveryPricing: sellerConfig.deliveryPolicy.pricing, cart: runtime.cart, now });
      runtime.cart = delivery.cartAfter;
      runtime.deliveryConfirmationState = delivery.previewState;
      runtime.runtimeStage = delivery.nextStep === "FINAL_ORDER_REVIEW"
        ? "FINAL_ORDER_REVIEW"
        : "COLLECTING_DELIVERY";
      await persist(input, runtime, fields);
      return asTurnResult({ ...replyFromDelivery(delivery), stage: runtime.runtimeStage, warnings: [...review.warnings, ...delivery.warnings] });
    }
    await persist(input, runtime, fields);
    return asTurnResult({ ...replyFromCartReview(review), stage: runtime.runtimeStage, warnings: review.warnings });
  }

  if (runtime.runtimeStage === "COLLECTING_DELIVERY" || runtime.runtimeStage === "FINAL_ORDER_REVIEW") {
    const delivery = runDeliveryConfirmationPreview({ previewEnabled: true, rawActionId: isGuardedOrderRuntimeAction(message) ? message : undefined, deliveryConfirmationText: !isGuardedOrderRuntimeAction(message) ? message : undefined, previewState: runtime.deliveryConfirmationState, sellerId: input.sellerId, conversationScopeId: input.conversationKey, productContext, requiredFields: fields, offerLookup: offers, deliveryPricing: sellerConfig.deliveryPolicy.pricing, cart: runtime.cart, now, cartReviewPreviewState: runtime.cartReviewState, cartItemEditPreviewState: runtime.itemEditState });
    if (!delivery.handled) return isGuardedOrderRuntimeAction(message) ? asTurnResult({ ...staleActionReply(), stage: runtime.runtimeStage }) : { handled: false, warnings: [] };
    runtime.cart = delivery.cartAfter;
    runtime.deliveryConfirmationState = delivery.previewState;
    if (delivery.nextStep === "RETURN_TO_CART_REVIEW") {
      const review = runCartReviewPreview({
        previewEnabled: true,
        sellerId: input.sellerId,
        productContext,
        requiredFields: fields,
        offerLookup: offers,
        cart: runtime.cart,
        previewState: runtime.cartReviewState,
        now,
      });
      runtime.cart = review.cartAfter;
      runtime.cartReviewState = review.previewState;
      runtime.itemEditState = review.cartItemEditPreviewState;
      runtime.deliveryConfirmationState = undefined;
      runtime.runtimeStage = "CART_REVIEW";
      await persist(input, runtime, fields);
      return asTurnResult({
        ...replyFromCartReview(review),
        stage: runtime.runtimeStage,
        warnings: [...delivery.warnings, ...review.warnings],
        failureCode: review.failureCode,
      });
    }
    else if (delivery.nextStep === "FINAL_ORDER_REVIEW") runtime.runtimeStage = "FINAL_ORDER_REVIEW";
    else if (delivery.nextStep === "CONFIRMED_ORDER_PREVIEW" && delivery.confirmedPreview && delivery.previewState) {
      const publicOrderCode = createPublicOrderCode();
      const receipt = await prepareConfirmedOrderReceipt({ previewEnabled: true, cart: runtime.cart, previewState: delivery.previewState, confirmedPreview: delivery.confirmedPreview, sellerId: input.sellerId, conversationScopeId: input.conversationKey, productContext, requiredFields: fields, offerLookup: offers, deliveryPricing: sellerConfig.deliveryPolicy.pricing, receiptContext: { storeName: sellerConfig.businessName, paymentMethodLabel: sellerConfig.receipt.paymentMethodLabel, deliveryText: sellerConfig.delivery.text }, now, snapshotId: publicOrderCode, confirmedAt: now.toISOString() });
      if (!receipt.success || !receipt.snapshot || !receipt.receiptDocument || !receipt.buffer) return asTurnResult({ ...recoveryReply(), stage: runtime.runtimeStage, warnings: receipt.warnings, failureCode: receipt.failureCode });
      runtime.runtimeStage = "CONFIRMED";
      runtime.confirmed = {
        snapshotId: receipt.snapshot.id,
        publicOrderCode,
        status: "CONFIRMED",
        receipt: { ...receipt.receiptDocument, dispatchStatus: "PENDING" },
        confirmedAt: receipt.snapshot.confirmedAt,
      };
      await persist(input, runtime, fields);
      return asTurnResult({
        text: `تم تأكيد الطلب ديالك بنجاح ✅\nشكراً لك، غادي نتواصلو معاك قريباً لتأكيد التوصيل.\nرقم الطلب: ${publicOrderCode}\nهذا هو وصل الطلب ديالك:`,
        stage: "CONFIRMED",
        warnings: receipt.warnings,
        confirmedSnapshotId: receipt.snapshot.id,
        publicOrderCode,
        receiptReady: true,
        receiptArtifact: {
          snapshotId: receipt.snapshot.id,
          publicOrderCode,
          document: receipt.receiptDocument,
          buffer: receipt.buffer,
          runtimeIdentity: identity,
        },
      });
    }
    await persist(input, runtime, fields);
    return asTurnResult({ ...replyFromDelivery(delivery), stage: runtime.runtimeStage, warnings: delivery.warnings });
  }

  return asTurnResult({ ...recoveryReply(), stage: "RECOVERY_REQUIRED" });
}
