import { createHash } from "node:crypto";
import {
  renderPremiumOrderReceiptPdfBuffer,
} from "../../../order-receipt/order-receipt.service";
import {
  PREMIUM_ORDER_RECEIPT_RENDERER_ID,
} from "../../../order-receipt/premium-order-receipt.types";
import {
  CONFIRMED_ORDER_RECEIPT_MODEL_VERSION,
} from "./confirmed-order-receipt.types";
import type {
  ConfirmedOrderReceiptBuildResult,
  ConfirmedOrderReceiptModel,
  ReceiptDocumentResult,
} from "./confirmed-order-receipt.types";
import type { ConfirmedOrderSnapshot } from "./confirmed-order-snapshot.types";

function safeText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function buildProductGroupKey(productId: string): string {
  return createHash("sha256")
    .update(`premium-receipt-product:${productId}`)
    .digest("hex")
    .slice(0, 24);
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}

function isSnapshotUsable(snapshot: ConfirmedOrderSnapshot): boolean {
  return Boolean(
    snapshot.schemaVersion === 1 &&
    snapshot.id &&
    snapshot.items.length > 0 &&
    snapshot.items.every(
      (item) =>
        item.quantity > 0 &&
        item.lineTotalMinor === item.unitPriceMinor * item.quantity,
    ) &&
    snapshot.standardSubtotalMinor >= 0 &&
    snapshot.finalTotalMinor >= 0 &&
    snapshot.currency,
  );
}

/** Maps immutable Phase 6.3 facts into the one canonical premium receipt model. */
export function buildConfirmedOrderReceiptModel(
  snapshot: ConfirmedOrderSnapshot,
): ConfirmedOrderReceiptBuildResult {
  if (!isSnapshotUsable(snapshot)) {
    return { success: false, failureCode: "INVALID_SNAPSHOT", warnings: [] };
  }

  const receiptBranding = snapshot.receiptContext.branding;
  const storeName = safeText(
    receiptBranding?.storeName || snapshot.receiptContext.storeName || "Boutique",
    160,
  );
  const receipt: ConfirmedOrderReceiptModel = {
    schemaVersion: CONFIRMED_ORDER_RECEIPT_MODEL_VERSION,
    rendererId: PREMIUM_ORDER_RECEIPT_RENDERER_ID,
    referenceId: safeText(snapshot.id, 64),
    storeName,
    confirmedAt: snapshot.confirmedAt,
    statusLabel: "Commande confirmée",
    branding: {
      storeName,
      ...(receiptBranding?.slogan
        ? { slogan: safeText(receiptBranding.slogan, 200) }
        : {}),
      ...(receiptBranding?.logoUrl ? { logoUrl: receiptBranding.logoUrl } : {}),
      ...(receiptBranding?.primaryColor
        ? { primaryColor: safeText(receiptBranding.primaryColor, 16) }
        : {}),
      ...(receiptBranding?.secondaryColor
        ? { secondaryColor: safeText(receiptBranding.secondaryColor, 16) }
        : {}),
      ...(receiptBranding?.accentColor
        ? { accentColor: safeText(receiptBranding.accentColor, 16) }
        : {}),
      ...(receiptBranding?.phone ? { phone: safeText(receiptBranding.phone, 80) } : {}),
      ...(receiptBranding?.whatsapp
        ? { whatsapp: safeText(receiptBranding.whatsapp, 80) }
        : {}),
      ...(receiptBranding?.email ? { email: safeText(receiptBranding.email, 160) } : {}),
      ...(receiptBranding?.website
        ? { website: safeText(receiptBranding.website, 240) }
        : {}),
      ...(receiptBranding?.address
        ? { address: safeText(receiptBranding.address, 240) }
        : {}),
      ...(receiptBranding?.instagram
        ? { instagram: safeText(receiptBranding.instagram, 160) }
        : {}),
      ...(receiptBranding?.facebook
        ? { facebook: safeText(receiptBranding.facebook, 160) }
        : {}),
      ...(receiptBranding?.tiktok
        ? { tiktok: safeText(receiptBranding.tiktok, 160) }
        : {}),
      ...(snapshot.receiptContext.footerMessage
        ? { footerMessage: safeText(snapshot.receiptContext.footerMessage, 240) }
        : {}),
      ...(snapshot.receiptContext.paymentMethodLabel
        ? {
            paymentMethodLabel: safeText(
              snapshot.receiptContext.paymentMethodLabel,
              160,
            ),
          }
        : {}),
    },
    lines: snapshot.items.map((item) => ({
      productGroupKey: buildProductGroupKey(item.productId),
      productName: safeText(item.productName, 200),
      quantity: item.quantity,
      options: item.selectedOptions.map((option) => ({
        label: safeText(option.label, 120),
        value: safeText(option.value, 240),
      })),
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      ...(item.productId === snapshot.product.productId && snapshot.receiptContext.productImageRef
        ? { imageRef: snapshot.receiptContext.productImageRef }
        : {}),
    })),
    deliveryFields: snapshot.orderFields.map((field) => ({
      key: safeText(field.key, 80),
      label: safeText(field.label, 120),
      value: safeText(field.value, 240),
    })),
    currency: safeText(snapshot.currency, 16),
    standardSubtotal: snapshot.standardSubtotal,
    ...(snapshot.selectedOffer
      ? {
          selectedOffer: {
            label: safeText(snapshot.selectedOffer.label || "Offre appliquée", 160),
            discountAmount: snapshot.selectedOffer.discountAmount,
            total: snapshot.selectedOffer.offerTotal,
          },
        }
      : {}),
    merchandiseTotal: snapshot.merchandiseTotal,
    ...(snapshot.deliveryFee
      ? {
          deliveryFee: {
            type: snapshot.deliveryFee.type,
            amount: snapshot.deliveryFee.amount,
            currency: safeText(snapshot.deliveryFee.currency, 16),
          },
        }
      : {}),
    finalTotal: snapshot.finalTotal,
    ...(snapshot.receiptContext.paymentMethodLabel
      ? {
          paymentMethodLabel: safeText(
            snapshot.receiptContext.paymentMethodLabel,
            160,
          ),
        }
      : {}),
    ...(snapshot.receiptContext.deliveryText
      ? { deliveryText: safeText(snapshot.receiptContext.deliveryText, 240) }
      : {}),
    ...(snapshot.receiptContext.productImageRef
      ? { productImageRef: snapshot.receiptContext.productImageRef }
      : {}),
    ...(snapshot.receiptContext.footerMessage
      ? { footerMessage: safeText(snapshot.receiptContext.footerMessage, 240) }
      : {}),
  };

  return { success: true, receiptModel: freeze(receipt), warnings: [] };
}

export async function generateConfirmedOrderReceiptPreviewPdf(
  model: ConfirmedOrderReceiptModel,
): Promise<ReceiptDocumentResult> {
  if (
    !model.lines.length ||
    !model.referenceId ||
    !model.currency ||
    model.rendererId !== PREMIUM_ORDER_RECEIPT_RENDERER_ID
  ) {
    return { success: false, failureCode: "INVALID_RECEIPT_MODEL", warnings: [] };
  }
  try {
    const buffer = await renderPremiumOrderReceiptPdfBuffer(model);
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return {
        success: false,
        failureCode: "PDF_GENERATION_FAILED",
        warnings: ["invalid_pdf_signature"],
      };
    }
    const safeReference = model.referenceId.replace(/[^A-Za-z0-9_-]/g, "_");
    const filename = `recu-commande-${safeReference}.pdf`;
    return {
      success: true,
      filename,
      mimeType: "application/pdf",
      byteLength: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      buffer,
      warnings: [],
    };
  } catch (_error) {
    return { success: false, failureCode: "PDF_GENERATION_FAILED", warnings: [] };
  }
}
