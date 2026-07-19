import { createHash } from "node:crypto";
import { renderOrderReceiptHtmlToPdfBuffer } from "../../../order-receipt/order-receipt.service";
import {
  CONFIRMED_ORDER_RECEIPT_MODEL_VERSION,
} from "./confirmed-order-receipt.types";
import type {
  ConfirmedOrderReceiptBuildResult,
  ConfirmedOrderReceiptModel,
  ReceiptDocumentResult,
} from "./confirmed-order-receipt.types";
import type { ConfirmedOrderSnapshot } from "./confirmed-order-snapshot.types";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function formatMoney(value: number, currency: string): string {
  return `${new Intl.NumberFormat("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${safeText(currency, 16)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value, 64);
  return new Intl.DateTimeFormat("fr-MA", {
    timeZone: "Africa/Casablanca",
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(date);
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
    snapshot.items.every((item) => item.quantity > 0 && item.lineTotalMinor === item.unitPriceMinor * item.quantity) &&
    snapshot.standardSubtotalMinor >= 0 &&
    snapshot.finalTotalMinor >= 0 &&
    snapshot.currency,
  );
}

export function buildConfirmedOrderReceiptModel(
  snapshot: ConfirmedOrderSnapshot,
): ConfirmedOrderReceiptBuildResult {
  if (!isSnapshotUsable(snapshot)) {
    return { success: false, failureCode: "INVALID_SNAPSHOT", warnings: [] };
  }

  const receipt: ConfirmedOrderReceiptModel = {
    schemaVersion: CONFIRMED_ORDER_RECEIPT_MODEL_VERSION,
    referenceId: safeText(snapshot.id, 64),
    storeName: safeText(snapshot.receiptContext.storeName || "Boutique", 160),
    confirmedAt: snapshot.confirmedAt,
    statusLabel: "Commande confirmée",
    lines: snapshot.items.map((item) => ({
      productName: safeText(item.productName, 200),
      quantity: item.quantity,
      options: item.selectedOptions.map((option) => ({
        label: safeText(option.label, 120),
        value: safeText(option.value, 240),
      })),
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    deliveryFields: snapshot.orderFields.map((field) => ({
      label: safeText(field.label, 120),
      value: safeText(field.value, 240),
    })),
    currency: safeText(snapshot.currency, 16),
    standardSubtotal: snapshot.standardSubtotal,
    ...(snapshot.selectedOffer
      ? {
          selectedOffer: {
            label: safeText(snapshot.selectedOffer.label || snapshot.selectedOffer.offerId, 160),
            discountAmount: snapshot.selectedOffer.discountAmount,
            total: snapshot.selectedOffer.offerTotal,
          },
        }
      : {}),
    finalTotal: snapshot.finalTotal,
    ...(snapshot.receiptContext.paymentMethodLabel
      ? { paymentMethodLabel: safeText(snapshot.receiptContext.paymentMethodLabel, 160) }
      : {}),
    ...(snapshot.receiptContext.deliveryText
      ? { deliveryText: safeText(snapshot.receiptContext.deliveryText, 240) }
      : {}),
  };

  return { success: true, receiptModel: freeze(receipt), warnings: [] };
}

function renderLine(item: ConfirmedOrderReceiptModel["lines"][number], currency: string): string {
  const options = item.options.length
    ? `<div class="options">${item.options.map((option) => `<div><span>${escapeHtml(option.label)}:</span> <b dir="auto">${escapeHtml(option.value)}</b></div>`).join("")}</div>`
    : "";
  return `<tr>
    <td><div class="product" dir="auto">${escapeHtml(item.productName)}</div>${options}</td>
    <td>${item.quantity}</td>
    <td>${escapeHtml(formatMoney(item.unitPrice, currency))}</td>
    <td>${escapeHtml(formatMoney(item.lineTotal, currency))}</td>
  </tr>`;
}

function buildReceiptHtml(model: ConfirmedOrderReceiptModel): string {
  const fields = model.deliveryFields.length
    ? model.deliveryFields.map((field) => `<div class="field"><span>${escapeHtml(field.label)}</span><b dir="auto">${escapeHtml(field.value)}</b></div>`).join("")
    : '<div class="field"><span>Informations</span><b>Non renseignées</b></div>';
  const offer = model.selectedOffer
    ? `<div class="total-row offer"><span>Offre: ${escapeHtml(model.selectedOffer.label)}</span><b>- ${escapeHtml(formatMoney(model.selectedOffer.discountAmount, model.currency))}</b></div>`
    : "";
  const supplementary = [
    model.paymentMethodLabel && `<div><b>Paiement:</b> ${escapeHtml(model.paymentMethodLabel)}</div>`,
    model.deliveryText && `<div><b>Livraison:</b> ${escapeHtml(model.deliveryText)}</div>`,
  ].filter(Boolean).join("");

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; color: #112b58; background: #f4f8fd; font-family: Arial, "Noto Naskh Arabic", sans-serif; font-size: 12px; }
main { min-height: 297mm; padding: 18mm; background: #fff; }
.top { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8mm; border-bottom: 2px solid #c78a22; }
.store { font-size: 25px; font-weight: 700; color: #062e67; }
.title { margin: 10mm 0 7mm; font-family: Georgia, serif; font-size: 27px; text-align: center; letter-spacing: .6px; color: #062e67; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 14px; border: 1px solid #bdcee8; border-radius: 7px; background: #f8fbff; }
.panel { margin-top: 8mm; border: 1px solid #bdcee8; border-radius: 7px; overflow: hidden; }
.panel h2 { margin: 0; padding: 9px 13px; color: #fff; background: #062e67; font-size: 13px; letter-spacing: .3px; }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; padding: 11px 13px; }
.field { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed #d6e0f0; }
.field span { font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th { padding: 9px 10px; color: #fff; background: #0a3876; text-align: left; font-size: 11px; }
td { padding: 11px 10px; vertical-align: top; border-top: 1px solid #d7e1f0; }
th:not(:first-child), td:not(:first-child) { text-align: center; white-space: nowrap; }
.product { font-size: 13px; font-weight: 700; }
.options { margin-top: 5px; line-height: 1.5; color: #304d7a; }
.summary { margin: 8mm 0 0 auto; width: 48%; min-width: 290px; border: 1px solid #bdcee8; border-radius: 7px; padding: 10px 13px; }
.total-row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; }
.offer { color: #09743f; }
.final { margin-top: 5px; padding-top: 8px; border-top: 2px solid #c78a22; font-size: 16px; color: #062e67; }
.notes { margin-top: 8mm; padding: 10px 13px; border-radius: 7px; background: #f4f8fd; line-height: 1.55; }
footer { margin-top: 13mm; padding-top: 5mm; border-top: 1px solid #bdcee8; color: #496485; font-size: 10px; text-align: center; }
</style></head>
<body><main>
  <header class="top"><div class="store" dir="auto">${escapeHtml(model.storeName)}</div><div><b>Référence:</b> ${escapeHtml(model.referenceId)}<br/><b>Statut:</b> ${escapeHtml(model.statusLabel)}</div></header>
  <h1 class="title">REÇU DE COMMANDE</h1>
  <section class="meta"><div><b>Date de confirmation</b><br/>${escapeHtml(formatDate(model.confirmedAt))}</div><div><b>Total articles</b><br/>${model.lines.reduce((total, line) => total + line.quantity, 0)}</div></section>
  <section class="panel"><h2>INFORMATIONS DE LIVRAISON</h2><div class="fields">${fields}</div></section>
  <section class="panel"><h2>DÉTAILS DE LA COMMANDE</h2><table><thead><tr><th>Produit</th><th>Quantité</th><th>Prix unitaire</th><th>Total</th></tr></thead><tbody>${model.lines.map((item) => renderLine(item, model.currency)).join("")}</tbody></table></section>
  <section class="summary"><div class="total-row"><span>Sous-total standard</span><b>${escapeHtml(formatMoney(model.standardSubtotal, model.currency))}</b></div>${offer}<div class="total-row final"><span>TOTAL À PAYER</span><b>${escapeHtml(formatMoney(model.finalTotal, model.currency))}</b></div></section>
  ${supplementary ? `<section class="notes">${supplementary}</section>` : ""}
  <footer>Merci pour votre commande. Ce reçu confirme l’enregistrement de votre demande.</footer>
</main></body></html>`;
}

export async function generateConfirmedOrderReceiptPreviewPdf(
  model: ConfirmedOrderReceiptModel,
): Promise<ReceiptDocumentResult> {
  if (!model.lines.length || !model.referenceId || !model.currency) {
    return { success: false, failureCode: "INVALID_RECEIPT_MODEL", warnings: [] };
  }
  try {
    const buffer = await renderOrderReceiptHtmlToPdfBuffer(buildReceiptHtml(model));
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return { success: false, failureCode: "PDF_GENERATION_FAILED", warnings: ["invalid_pdf_signature"] };
    }
    const filename = `order-${model.referenceId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
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
