import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import type {
  ReceiptBrandingSnapshot,
  ReceiptProductSnapshot,
} from "../agent/order/confirmed-order-store.service";
import type {
  OrderReceiptOrder,
  OrderReceiptRecord,
  ReceiptSendStatus,
} from "./order-receipt.types";
import {
  PREMIUM_ORDER_RECEIPT_RENDERER_ID,
} from "./premium-order-receipt.types";
import type {
  PremiumOrderReceiptViewModel,
  PremiumReceiptBranding,
  PremiumReceiptCustomerField,
  PremiumReceiptItem,
} from "./premium-order-receipt.types";
import {
  groupPremiumReceiptItems,
} from "./premium-order-receipt-grouping.service";
import type {
  PremiumReceiptProductGroup,
} from "./premium-order-receipt-grouping.service";
import {
  validateConfirmedOrderReceiptSnapshot,
} from "./order-receipt-validation.service";

type GenerateReceiptResult = {
  ok: boolean;
  pdfPath?: string;
  exists: boolean;
  sizeBytes: number;
  errorMessage?: string;
  errorCode?: "RECEIPT_DATA_INVALID";
  invalidFields?: string[];
};

export type LocalReceiptDeleteResult = {
  localFileDeleted: boolean;
  localFileDeletedAt?: string;
  localFileDeleteError?: string;
  pdfExistsAfterSend: boolean;
};

type OrderReceiptDiagnostics = {
  totalOrderReceiptPdfGenerated: number;
  totalOrderReceiptPdfFailed: number;
  totalOrderReceiptDocumentsSent: number;
  totalOrderReceiptDocumentsFailed: number;
  totalOrderReceiptDuplicateSkipped: number;
  totalOrderReceiptLocalFilesDeleted: number;
  totalOrderReceiptLocalFileDeleteFailed: number;
  totalOrderReceiptCleanupDeleted: number;
  lastOrderReceiptSentAt?: string;
  lastOrderReceiptLocalFileDeletedAt?: string;
  lastOrderReceiptCleanupAt?: string;
};

const receiptRecords = new Map<string, OrderReceiptRecord>();
const diagnostics: OrderReceiptDiagnostics = {
  totalOrderReceiptPdfGenerated: 0,
  totalOrderReceiptPdfFailed: 0,
  totalOrderReceiptDocumentsSent: 0,
  totalOrderReceiptDocumentsFailed: 0,
  totalOrderReceiptDuplicateSkipped: 0,
  totalOrderReceiptLocalFilesDeleted: 0,
  totalOrderReceiptLocalFileDeleteFailed: 0,
  totalOrderReceiptCleanupDeleted: 0,
};

function logJson(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveFromBackendRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getOrderReceiptOutputDir(): string {
  return resolveFromBackendRoot(env.orderReceiptOutputDir);
}

export function getOrderReceiptPdfPath(
  orderId: string,
  publicOrderCode?: string,
): string {
  const filename = publicOrderCode
    ? `recu-commande-${publicOrderCode}.pdf`
    : `${orderId}.pdf`;

  return path.join(getOrderReceiptOutputDir(), filename);
}

export function getOrderReceiptRecord(orderId: string): OrderReceiptRecord | undefined {
  return receiptRecords.get(orderId);
}

export function getOrderReceiptDiagnostics(): OrderReceiptDiagnostics {
  return { ...diagnostics };
}

export function recordOrderReceiptDocumentSent(input: {
  orderId: string;
  pdfPath: string;
  mediaId?: string;
  localFileDeleted?: boolean;
  localFileDeletedAt?: string;
  localFileDeleteError?: string;
}) {
  diagnostics.totalOrderReceiptDocumentsSent += 1;
  diagnostics.lastOrderReceiptSentAt = new Date().toISOString();
  receiptRecords.set(input.orderId, {
    orderId: input.orderId,
    pdfPath: input.pdfPath,
    mediaId: input.mediaId,
    sentAt: diagnostics.lastOrderReceiptSentAt,
    sendStatus: "SENT",
    localFileDeleted: input.localFileDeleted,
    localFileDeletedAt: input.localFileDeletedAt,
    localFileDeleteError: input.localFileDeleteError,
  });
}

export function recordOrderReceiptDocumentFailed(input: {
  orderId: string;
  pdfPath?: string;
  errorMessage: string;
  errorCode?: "RECEIPT_DATA_INVALID";
  invalidFields?: string[];
  localFileDeleted?: boolean;
  localFileDeletedAt?: string;
  localFileDeleteError?: string;
}) {
  diagnostics.totalOrderReceiptDocumentsFailed += 1;
  receiptRecords.set(input.orderId, {
    orderId: input.orderId,
    pdfPath: input.pdfPath,
    sendStatus: "FAILED",
    lastError: input.errorMessage,
    errorCode: input.errorCode,
    invalidFields: input.invalidFields,
    localFileDeleted: input.localFileDeleted,
    localFileDeletedAt: input.localFileDeletedAt,
    localFileDeleteError: input.localFileDeleteError,
  });
}

export function recordOrderReceiptSkipped(input: {
  orderId: string;
  pdfPath?: string;
  status?: ReceiptSendStatus;
}) {
  diagnostics.totalOrderReceiptDuplicateSkipped += 1;
  const existingRecord = receiptRecords.get(input.orderId);
  receiptRecords.set(input.orderId, {
    orderId: input.orderId,
    pdfPath: input.pdfPath || existingRecord?.pdfPath,
    mediaId: existingRecord?.mediaId,
    sentAt: existingRecord?.sentAt,
    sendStatus:
      existingRecord?.sendStatus === "SENT"
        ? "SENT"
        : input.status || "SKIPPED",
    lastError: existingRecord?.lastError,
    errorCode: existingRecord?.errorCode,
    invalidFields: existingRecord?.invalidFields,
    localFileDeleted: existingRecord?.localFileDeleted,
    localFileDeletedAt: existingRecord?.localFileDeletedAt,
    localFileDeleteError: existingRecord?.localFileDeleteError,
  });
  logJson({
    event: "order_receipt.duplicate_skipped",
    orderId: input.orderId,
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

export async function orderReceiptFileExists(filePath: string): Promise<boolean> {
  return fileExists(filePath);
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (_error) {
    return 0;
  }
}

export async function deleteLocalReceiptPdf(
  orderId: string,
  pdfPath: string,
): Promise<LocalReceiptDeleteResult> {
  try {
    if (!(await fileExists(pdfPath))) {
      const deletedAt = new Date().toISOString();

      logJson({
        event: "order_receipt.local_pdf.deleted",
        orderId,
        pdfPath,
        alreadyMissing: true,
      });

      return {
        localFileDeleted: true,
        localFileDeletedAt: deletedAt,
        pdfExistsAfterSend: false,
      };
    }

    await fs.unlink(pdfPath);

    const deletedAt = new Date().toISOString();

    diagnostics.totalOrderReceiptLocalFilesDeleted += 1;
    diagnostics.lastOrderReceiptLocalFileDeletedAt = deletedAt;

    const existingRecord = receiptRecords.get(orderId);
    receiptRecords.set(orderId, {
      orderId,
      pdfPath,
      mediaId: existingRecord?.mediaId,
      sentAt: existingRecord?.sentAt,
      sendStatus: existingRecord?.sendStatus || "SENT",
      lastError: existingRecord?.lastError,
      localFileDeleted: true,
      localFileDeletedAt: deletedAt,
    });

    logJson({
      event: "order_receipt.local_pdf.deleted",
      orderId,
      pdfPath,
    });

    return {
      localFileDeleted: true,
      localFileDeletedAt: deletedAt,
      pdfExistsAfterSend: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    diagnostics.totalOrderReceiptLocalFileDeleteFailed += 1;
    logJson({
      event: "order_receipt.local_pdf.delete_failed",
      orderId,
      pdfPath,
      errorMessage,
    });

    return {
      localFileDeleted: false,
      localFileDeleteError: errorMessage,
      pdfExistsAfterSend: await fileExists(pdfPath),
    };
  }
}

export async function cleanupOldOrderReceiptPdfs(): Promise<{
  ok: boolean;
  deletedCount: number;
  errorMessage?: string;
}> {
  if (!env.orderReceiptCleanupOnStart) {
    return {
      ok: true,
      deletedCount: 0,
    };
  }

  const outputDir = getOrderReceiptOutputDir();
  const maxAgeMs = Math.max(env.orderReceiptCleanupMaxAgeHours, 1) * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  let deletedCount = 0;

  try {
    const entries = await fs.readdir(outputDir, {
      withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }

      const filePath = path.join(outputDir, entry.name);
      const stat = await fs.stat(filePath);

      if (stat.mtimeMs > cutoff) {
        continue;
      }

      await fs.unlink(filePath);
      deletedCount += 1;
    }

    diagnostics.totalOrderReceiptCleanupDeleted += deletedCount;
    diagnostics.lastOrderReceiptCleanupAt = new Date().toISOString();
    logJson({
      event: "order_receipt.cleanup.completed",
      outputDir,
      deletedCount,
      maxAgeHours: env.orderReceiptCleanupMaxAgeHours,
    });

    return {
      ok: true,
      deletedCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    diagnostics.lastOrderReceiptCleanupAt = new Date().toISOString();
    logJson({
      event: "order_receipt.cleanup.failed",
      outputDir,
      errorMessage,
    });

    return {
      ok: false,
      deletedCount,
      errorMessage,
    };
  }
}

const DEFAULT_PRIMARY_COLOR = "#062E67";
const DEFAULT_ACCENT_COLOR = "#C78A22";
const DEFAULT_SOFT_BACKGROUND = "#F4F8FD";
const MAX_REMOTE_IMAGE_BYTES = 2 * 1024 * 1024;

function isSafeColor(
  value: string | undefined,
  fallback: string,
  rejectVeryLight = false,
): string {
  const candidate = value?.trim() || "";

  if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return fallback;
  }

  if (rejectVeryLight) {
    const red = Number.parseInt(candidate.slice(1, 3), 16);
    const green = Number.parseInt(candidate.slice(3, 5), 16);
    const blue = Number.parseInt(candidate.slice(5, 7), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

    if (luminance > 0.78) {
      return fallback;
    }
  }

  return candidate;
}

function mixHexColor(color: string, target: string, ratio: number): string {
  const mixChannel = (start: number, end: number) =>
    Math.round(start + (end - start) * ratio)
      .toString(16)
      .padStart(2, "0");
  const channels = [1, 3, 5].map((index) => ({
    start: Number.parseInt(color.slice(index, index + 2), 16),
    end: Number.parseInt(target.slice(index, index + 2), 16),
  }));

  return `#${channels.map(({ start, end }) => mixChannel(start, end)).join("")}`;
}

function getColorLuminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function hasMeaningfulTime(value: string): boolean {
  const timeMatch = value.match(/T(\d{2}):(\d{2})/);

  return Boolean(timeMatch && (timeMatch[1] !== "00" || timeMatch[2] !== "00"));
}

function formatDate(value: string, includeTime: boolean): string {
  try {
    const parts = new Intl.DateTimeFormat("fr-MA", {
      timeZone: "Africa/Casablanca",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(value));
    const getPart = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || "";
    const date = `${getPart("day")}/${getPart("month")}/${getPart("year")}`;
    const time = `${getPart("hour")}:${getPart("minute")}`;

    return !includeTime || !hasMeaningfulTime(value) || time === "00:00"
      ? date
      : `${date} à ${time}`;
  } catch (_error) {
    return value;
  }
}

function formatMoney(value: number, currency: string): string {
  const formatted = new Intl.NumberFormat("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

  return `${formatted} ${currency === "درهم" ? "MAD" : currency || "MAD"}`;
}

function getStoreInitials(storeName: string): string {
  const initials = storeName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");

  return initials || "B";
}

function maskAssetReference(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/…`;
  } catch (_error) {
    return path.basename(value) || "configured asset";
  }
}

async function readImageAsDataUri(
  reference: string | undefined,
  event: "order_receipt.logo.fallback" | "order_receipt.product_image.fallback",
): Promise<string | undefined> {
  const source = reference?.trim();

  if (!source) {
    return undefined;
  }

  try {
    if (/^https?:\/\//i.test(source)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      const response = await fetch(source, {
        signal: controller.signal,
        redirect: "error",
      }).finally(() => clearTimeout(timeout));
      const contentType = response.headers.get("content-type") || "";
      const contentLength = Number(response.headers.get("content-length") || "0");

      if (!response.ok || !contentType.startsWith("image/") || contentLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error("Remote image response is not an allowed image");
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      if (bytes.length > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error("Remote image exceeds the size limit");
      }

      return `data:${contentType.split(";")[0]};base64,${bytes.toString("base64")}`;
    }

    const filePath = resolveFromBackendRoot(source);
    const bytes = await fs.readFile(filePath);

    if (bytes.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error("Local image exceeds the size limit");
    }

    const extension = path.extname(filePath).toLowerCase();
    const mimeType = extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : extension === ".svg"
          ? "image/svg+xml"
          : "image/jpeg";

    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    logJson({
      event,
      asset: maskAssetReference(source),
      reason: error instanceof Error ? error.message : "Unable to load asset",
    });
    return undefined;
  }
}

function getReceiptBranding(order: OrderReceiptOrder): ReceiptBrandingSnapshot {
  return {
    storeName: order.receiptBranding?.storeName || env.orderReceiptStoreName || "Boutique",
    phone: order.receiptBranding?.phone || env.orderReceiptSupportPhone || undefined,
    ...order.receiptBranding,
  };
}

function getReceiptProduct(order: OrderReceiptOrder): ReceiptProductSnapshot {
  const attributes = order.receiptProduct?.attributes?.filter(
    (attribute) => attribute.label?.trim() && attribute.value?.trim(),
  ) || [];

  if (!attributes.length) {
    if (order.size) {
      attributes.push({ label: "Taille", value: order.size });
    }
    if (order.color) {
      attributes.push({ label: "Couleur", value: order.color });
    }
  }

  return {
    imageRef: order.receiptProduct?.imageRef,
    attributes,
  };
}

/** Adapts legacy confirmed orders to the same premium model used by Phase 6.3. */
export function buildLegacyPremiumReceiptModel(
  order: OrderReceiptOrder,
): PremiumOrderReceiptViewModel {
  const branding = getReceiptBranding(order);
  const product = getReceiptProduct(order);
  const confirmedAt = order.confirmedAt || order.createdAt;
  const notes = (order as OrderReceiptOrder & { notes?: string }).notes?.trim();

  return {
    schemaVersion: 1,
    rendererId: PREMIUM_ORDER_RECEIPT_RENDERER_ID,
    referenceId: order.publicOrderCode,
    storeName: branding.storeName,
    confirmedAt,
    statusLabel: "Commande confirmée",
    branding: {
      ...branding,
      storeName: branding.storeName,
    },
    lines: [
      {
        productName: order.productName,
        quantity: order.pricing.quantity,
        options: product.attributes.map((attribute) => ({
          label: attribute.label,
          value: attribute.value,
        })),
        unitPrice: order.pricing.unitPrice,
        lineTotal: order.pricing.subtotal,
        ...(product.imageRef ? { imageRef: product.imageRef } : {}),
      },
    ],
    deliveryFields: [
      { key: "fullName", label: "Nom complet", value: order.fullName },
      { key: "phone", label: "Téléphone", value: order.phone },
      { key: "city", label: "Ville", value: order.city },
      { key: "address", label: "Adresse", value: order.address },
    ],
    currency: order.pricing.currency || order.currency || "MAD",
    standardSubtotal: order.pricing.subtotal,
    merchandiseTotal: order.pricing.subtotal,
    deliveryFee: {
      type: order.pricing.deliveryPrice === 0 ? "FREE" : "PAID",
      amount: order.pricing.deliveryPrice,
      currency: order.pricing.currency || order.currency || "MAD",
    },
    finalTotal: order.pricing.total,
    ...(branding.paymentMethodLabel
      ? { paymentMethodLabel: branding.paymentMethodLabel }
      : {}),
    ...(product.imageRef ? { productImageRef: product.imageRef } : {}),
    ...(branding.footerMessage ? { footerMessage: branding.footerMessage } : {}),
    ...(notes ? { notes } : {}),
  };
}

type ReceiptIconKind =
  | "phone"
  | "mail"
  | "globe"
  | "location"
  | "instagram"
  | "order"
  | "calendar"
  | "status"
  | "customer"
  | "product"
  | "cart"
  | "recap"
  | "payment"
  | "info"
  | "heart";

function receiptIcon(kind: ReceiptIconKind, className = "receipt-icon"): string {
  const paths: Record<ReceiptIconKind, string> = {
    phone: '<path d="M7.1 3.6 9.4 7 7.8 8.7a15 15 0 0 0 7.5 7.5l1.7-1.7 3.4 2.3-.8 3.1c-.2.7-.8 1.1-1.5 1.1A15.1 15.1 0 0 1 3 5.9c0-.7.4-1.3 1.1-1.5l3-.8Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="1.8"/><path d="m4 7 8 6 8-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9S14.5 18.3 12 21c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3Z"/>',
    location: '<path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.7" r=".8" fill="currentColor" stroke="none"/>',
    order: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h3"/><circle cx="17.3" cy="17.3" r="3.3" fill="#fff"/><path d="m15.9 17.3 1 1 1.8-2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 9h18M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01"/>',
    status: '<path d="m12 3 2.1 2.2 3-.2.7 3 2.5 1.7-1.2 2.8 1.2 2.8-2.5 1.7-.7 3-3-.2L12 21l-2.1-2.2-3 .2-.7-3-2.5-1.7 1.2-2.8-1.2-2.8L6.2 8l.7-3 3 .2L12 3Z"/><path d="m9.2 12 1.8 1.8 3.8-4"/>',
    customer: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2.5a7 7 0 0 1 14 0V21"/>',
    product: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9M8 5.3l8 4.5"/>',
    cart: '<path d="M3 4h2l2.2 11.2h10.7l2-7.4H6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    recap: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h8"/>',
    payment: '<rect x="3" y="3.5" width="15" height="9" rx="1.5"/><circle cx="10.5" cy="8" r="2"/><path d="M5.5 6h.01M15.5 10h.01M3.5 17.2h4.2l2.1-2.1h5.7c1.2 0 2 .8 2 1.8 0 .5-.2.9-.5 1.2l-4.4 3H7.2l-3.7-1.8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/>',
    heart: '<path d="M20.8 4.9a5.4 5.4 0 0 0-7.6 0L12 6.1l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.5a5.4 5.4 0 0 0 0-7.6Z"/>',
  };

  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}

function buildHeaderContacts(branding: PremiumReceiptBranding): string {
  const phone = branding.whatsapp || branding.phone;
  const contacts = [
    phone && { icon: "phone" as const, value: phone },
    branding.email && { icon: "mail" as const, value: branding.email },
    branding.instagram && { icon: "instagram" as const, value: branding.instagram },
    branding.address
      ? { icon: "location" as const, value: branding.address }
      : branding.website && { icon: "globe" as const, value: branding.website },
  ].filter(Boolean) as Array<{
    icon: "phone" | "mail" | "globe" | "location" | "instagram";
    value: string;
  }>;

  return contacts
    .map(
      (contact) =>
        `<div class="contact-row">${receiptIcon(contact.icon)}<span dir="auto">${escapeHtml(contact.value)}</span></div>`,
    )
    .join("");
}

function buildSocialItems(branding: PremiumReceiptBranding): string {
  const social = branding.instagram
    ? { icon: "instagram" as const, value: branding.instagram }
    : branding.facebook
      ? { icon: "globe" as const, value: branding.facebook }
      : branding.tiktok
        ? { icon: "globe" as const, value: branding.tiktok }
        : undefined;

  return social
    ? `<div class="footer-social"><span class="footer-social-icon">${receiptIcon(social.icon)}</span><span dir="auto">${escapeHtml(social.value)}</span></div>`
    : "";
}

function getCustomerFieldIcon(field: PremiumReceiptCustomerField): ReceiptIconKind {
  const key = `${field.key || ""} ${field.label}`.toLocaleLowerCase();
  if (/phone|téléphone|telephone|هاتف/.test(key)) return "phone";
  if (/name|nom|اسم/.test(key)) return "customer";
  if (/city|ville|address|adresse|location|مدينة|عنوان/.test(key)) return "location";
  return "info";
}

function renderVariantOptions(
  item: PremiumReceiptItem,
  variantIndex: number,
  variantCount: number,
): string {
  if (!item.options.length) {
    const label = variantCount > 1 ? `Article ${variantIndex + 1}` : "Standard";
    return `<span class="variant-empty">${label}</span>`;
  }

  return `<div class="variant-options">${item.options
    .map(
      (option, optionIndex) =>
        `${optionIndex > 0 ? '<span class="variant-separator" aria-hidden="true">·</span>' : ""}<span class="variant-option"><span class="variant-option-label" dir="auto">${escapeHtml(option.label)} :</span><span class="variant-option-value dynamic-value" dir="auto">${escapeHtml(option.value)}</span></span>`,
    )
    .join("")}</div>`;
}

function renderReceiptProductGroup(
  group: PremiumReceiptProductGroup,
  currency: string,
): string {
  const groupSizeClass = group.variants.length <= 3
    ? " item-group-compact"
    : " item-group-large";
  const titleRow = `<div class="item-group-title-cell item-product-cell column-product"><div class="item-product-name dynamic-value" dir="auto">${escapeHtml(group.productName)}</div></div><div class="item-group-title-cell column-quantity" aria-hidden="true"></div><div class="item-group-title-cell column-unit-price" aria-hidden="true"></div><div class="item-group-title-cell column-total" aria-hidden="true"></div>`;
  const variantRows = group.variants
    .map((item, variantIndex) => {
      const continuationClass = variantIndex > 0 ? " variant-continuation" : "";
      return `<div class="variant-cell variant-product-cell column-product${continuationClass}">${renderVariantOptions(item, variantIndex, group.variants.length)}</div><div class="variant-cell variant-numeric-cell column-quantity${continuationClass}">${escapeHtml(item.quantity)}</div><div class="variant-cell variant-numeric-cell column-unit-price${continuationClass}">${escapeHtml(formatMoney(item.unitPrice, currency))}</div><div class="variant-cell variant-numeric-cell column-total${continuationClass}">${escapeHtml(formatMoney(item.lineTotal, currency))}</div>`;
    })
    .join("");

  return `<div class="item-group-row${groupSizeClass}">${titleRow}${variantRows}</div>`;
}

export async function buildPremiumOrderReceiptHtml(
  model: PremiumOrderReceiptViewModel,
): Promise<string> {
  const branding = model.branding;
  const primaryColor = isSafeColor(
    branding.primaryColor,
    DEFAULT_PRIMARY_COLOR,
    true,
  );
  const primaryDark = mixHexColor(primaryColor, "#000000", 0.3);
  const configuredSecondary = isSafeColor(
    branding.secondaryColor,
    DEFAULT_SOFT_BACKGROUND,
  );
  const softBackground = getColorLuminance(configuredSecondary) > 0.78
    ? configuredSecondary
    : DEFAULT_SOFT_BACKGROUND;
  const accentColor = isSafeColor(
    branding.accentColor || (getColorLuminance(configuredSecondary) <= 0.78
      ? configuredSecondary
      : undefined),
    DEFAULT_ACCENT_COLOR,
    true,
  );
  const borderColor = mixHexColor(primaryColor, "#FFFFFF", 0.82);
  const logoDataUri = await readImageAsDataUri(
    branding.logoUrl || env.orderReceiptLogoPath,
    "order_receipt.logo.fallback",
  );
  const productImageDataUri = await readImageAsDataUri(
    model.productImageRef || model.lines.find((line) => line.imageRef)?.imageRef,
    "order_receipt.product_image.fallback",
  );
  const currency = model.currency === "درهم" ? "MAD" : model.currency || "MAD";
  const deliveryText = !model.deliveryFee
    ? "À confirmer"
    : model.deliveryFee.type === "FREE" || model.deliveryFee.amount === 0
    ? "Gratuit"
    : formatMoney(model.deliveryFee.amount, model.deliveryFee.currency || currency);
  const totalText = formatMoney(model.finalTotal, currency);
  const logoHtml = logoDataUri
    ? `<img class="logo-image" src="${logoDataUri}" alt="Logo ${escapeHtml(branding.storeName)}" />`
    : `<div class="logo-fallback" aria-label="Logo de secours">${escapeHtml(getStoreInitials(branding.storeName))}</div>`;
  const primaryProductName = model.lines[0]?.productName || "Produit";
  const productVisual = productImageDataUri
    ? `<img class="product-image" src="${productImageDataUri}" alt="${escapeHtml(primaryProductName)}" />`
    : `<div class="product-placeholder"><span class="product-placeholder-badge">${escapeHtml(getStoreInitials(primaryProductName))}</span><strong class="dynamic-value" dir="auto">${escapeHtml(primaryProductName)}</strong><small>Visuel du produit non disponible</small></div>`;
  const footerMessage = model.footerMessage || branding.footerMessage || "Merci pour votre commande !";
  const paymentMethod = model.paymentMethodLabel || branding.paymentMethodLabel || "Paiement à la livraison";
  const headerContacts = buildHeaderContacts(branding);
  const socialItems = buildSocialItems(branding);
  const specificNote = model.notes?.trim();
  const customerRows = model.deliveryFields
    .map(
      (field) =>
        `<div class="customer-row"><span class="customer-label-group">${receiptIcon(getCustomerFieldIcon(field))}<span class="customer-label">${escapeHtml(field.label)}</span></span><span class="customer-value dynamic-value" dir="auto">${escapeHtml(field.value)}</span></div>`,
    )
    .join("");
  const productGroups = groupPremiumReceiptItems(model.lines);
  const itemRows = productGroups
    .map((group) => renderReceiptProductGroup(group, currency))
    .join("");
  const densityClass =
    model.lines.length > 1 || model.deliveryFields.length > 4 || model.selectedOffer
      ? " receipt-dense"
      : "";
  const paginationClass = model.lines.length > 4 ? " receipt-multipage" : "";
  const extraDensityClass =
    model.selectedOffer || model.deliveryFields.length > 4
      ? " receipt-extra-dense"
      : "";
  const offerRows = model.selectedOffer
    ? `<div class="summary-line offer-line"><span>Réduction - ${escapeHtml(model.selectedOffer.label)}</span><strong>- ${escapeHtml(formatMoney(model.selectedOffer.discountAmount, currency))}</strong></div><div class="summary-line"><span>Total après offre</span><strong>${escapeHtml(formatMoney(model.merchandiseTotal, currency))}</strong></div>`
    : "";
  const productImageRenderMode = productImageDataUri
    ? "real_image_rendered"
    : "fallback_rendered";

  logJson({
    event: "order_receipt.branding.resolved",
    publicOrderCode: model.referenceId,
    rendererId: model.rendererId,
    storeName: branding.storeName,
    logoResolved: Boolean(logoDataUri),
    productImageResolved: Boolean(productImageDataUri),
    productImageRenderMode,
  });
  logJson({
    event: "order_receipt.product_image.rendered",
    publicOrderCode: model.referenceId,
    mode: productImageRenderMode,
  });
  logJson({
    event: productImageDataUri
      ? "order_receipt.product_image.real_rendered"
      : "order_receipt.product_image.fallback_rendered",
    publicOrderCode: model.referenceId,
    productImageResolved: Boolean(productImageDataUri),
  });

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; }
      html, body { width: 210mm; min-height: 297mm; }
      body { margin: 0; color: #071d43; font-family: "Inter", "Noto Sans Arabic", "Segoe UI", Arial, sans-serif; font-size: 10.5px; font-weight: 400; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .receipt-page { width: 210mm; min-height: 297mm; padding: 9mm 10mm 0; display: flex; flex-direction: column; overflow: visible; background: #fff; }
      .header { display: grid; grid-template-columns: minmax(0, 1fr) 245px; gap: 30px; align-items: center; min-height: 88px; }
      .header.no-contacts { grid-template-columns: 1fr; }
      .brand { display: flex; align-items: center; gap: 18px; min-width: 0; }
      .logo-wrap { width: 84px; height: 84px; flex: 0 0 84px; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 50%; background: ${softBackground}; }
      .logo-image { width: 82px; height: 82px; max-width: 100%; max-height: 100%; object-fit: contain; }
      .logo-fallback { width: 78px; height: 78px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${primaryColor}; color: ${accentColor}; border: 2px solid ${accentColor}; font-family: Georgia, "Times New Roman", serif; font-size: 29px; font-weight: 700; }
      .store-name { color: ${primaryDark}; font-family: Georgia, "Times New Roman", serif; font-size: 31px; line-height: 1.04; font-weight: 700; overflow-wrap: anywhere; }
      .slogan { margin-top: 7px; color: ${accentColor}; font-size: 13px; line-height: 1.3; }
      .brand-accent { width: 42px; height: 1px; margin-top: 11px; background: ${accentColor}; }
      .header-contacts { display: grid; gap: 7px; min-height: 72px; padding: 4px 0 4px 28px; border-left: 1px solid ${borderColor}; color: ${primaryDark}; font-size: 12px; }
      .contact-row { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 9px; min-width: 0; }
      .contact-row svg { width: 17px; height: 17px; color: ${primaryColor}; }
      .contact-row span { overflow-wrap: anywhere; unicode-bidi: plaintext; }
      .title-block { margin: 13px 0 15px; text-align: center; }
      .title { margin: 0; color: ${primaryDark}; font-family: Georgia, "Times New Roman", serif; font-size: 31px; line-height: 1.1; font-weight: 700; letter-spacing: 1.5px; }
      .title-ornament { display: flex; align-items: center; justify-content: center; gap: 9px; margin-top: 10px; color: ${accentColor}; }
      .ornament-line { width: 98px; height: 1px; background: ${accentColor}; }
      .ornament-diamond { width: 10px; height: 10px; transform: rotate(45deg); border: 1.5px solid ${accentColor}; background: #fff; }
      .meta { display: grid; grid-template-columns: 1fr 1fr 1.12fr; min-height: 72px; border: 1px solid ${borderColor}; border-radius: 11px; overflow: hidden; background: #fff; }
      .meta-item { display: grid; grid-template-columns: 42px minmax(0, 1fr); align-items: center; gap: 11px; padding: 10px 16px; min-width: 0; }
      .meta-item + .meta-item { border-left: 1px solid ${borderColor}; }
      .meta-icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: ${primaryColor}; }
      .meta-icon svg { width: 34px; height: 34px; }
      .meta-label { display: block; margin-bottom: 4px; color: ${primaryColor}; font-size: 9.5px; font-weight: 600; letter-spacing: .35px; text-transform: uppercase; }
      .meta-value { color: ${primaryDark}; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
      .status-badge { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 999px; background: #dcf5e5; color: #187342; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
      .top-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 23px; align-items: stretch; break-inside: avoid; page-break-inside: avoid; }
      .panel { position: relative; min-width: 0; border: 1px solid ${borderColor}; border-radius: 12px; background: #fff; overflow: hidden; }
      .section-heading { position: absolute; z-index: 1; top: 0; left: 0; display: inline-flex; align-items: center; gap: 9px; min-width: 230px; height: 38px; margin: 0; padding: 0 17px; border-radius: 10px 10px 10px 0; background: linear-gradient(105deg, ${primaryDark}, ${primaryColor}); color: #fff; font-size: 11.5px; font-weight: 600; letter-spacing: .25px; }
      .section-heading svg { width: 19px; height: 19px; flex: 0 0 19px; }
      .customer-list { min-height: 220px; padding: 45px 20px 7px; }
      .customer-row { display: grid; grid-template-columns: 164px minmax(0, 1fr); gap: 10px; align-items: center; min-height: 42px; border-bottom: 1px dashed ${borderColor}; direction: ltr; }
      .customer-row:last-child { border-bottom: 0; }
      .customer-label-group { display: flex; align-items: center; gap: 11px; min-width: 0; color: ${primaryDark}; }
      .customer-label-group svg { width: 19px; height: 19px; flex: 0 0 19px; color: ${primaryColor}; }
      .customer-label { color: ${primaryDark}; font-size: 11px; font-weight: 500; }
      .customer-value { color: ${primaryDark}; font-size: 12.5px; font-weight: 500; overflow-wrap: anywhere; unicode-bidi: plaintext; text-align: right; }
      .product-panel { display: flex; flex-direction: column; min-height: 220px; border-color: ${mixHexColor(primaryColor, "#FFFFFF", 0.87)}; }
      .product-visual { flex: 0 0 218px; height: 218px; min-height: 218px; max-height: 218px; display: flex; align-items: center; justify-content: center; padding: 40px 11px 8px; background: linear-gradient(180deg, #fff 72%, ${softBackground}); }
      .product-image { width: 92%; height: 92%; max-width: 92%; max-height: 92%; object-fit: contain; }
      .product-placeholder { width: 88%; min-height: 145px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; color: ${primaryDark}; border: 1px dashed ${borderColor}; border-radius: 10px; background: rgba(244,248,253,.8); }
      .product-placeholder-badge { width: 54px; height: 54px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: ${primaryColor}; color: ${accentColor}; border: 1px solid ${accentColor}; font-family: Georgia, "Times New Roman", serif; font-size: 18px; font-weight: 700; }
      .product-placeholder strong { max-width: 85%; font-size: 12px; font-weight: 600; }
      .product-placeholder small { color: #697a90; font-size: 9px; }
      .details { flex: 0 0 auto; margin-top: 20px; padding-top: 43px; border-color: ${mixHexColor(primaryColor, "#FFFFFF", 0.78)}; border-radius: 12px; }
      .details .section-heading { top: -1px; left: -1px; min-width: 286px; height: 44px; padding: 0 21px; gap: 11px; border-radius: 12px 12px 0 0; box-shadow: inset 0 -2px 0 ${accentColor}; }
      .details .section-heading svg { width: 20px; height: 20px; flex-basis: 20px; }
      .item-grid, .item-group-row { display: grid; grid-template-columns: minmax(0, 2.4fr) .72fr 1.14fr 1.04fr; align-items: stretch; }
      .item-grid > div { min-width: 0; padding: 12px 20px; }
      .item-grid > div + div { border-left: 1px solid ${borderColor}; }
      .item-head { min-height: 39px; color: #fff; font-size: 10.5px; font-weight: 600; letter-spacing: .4px; text-transform: uppercase; background: linear-gradient(100deg, ${primaryDark}, ${primaryColor}); }
      .item-head > div { display: flex; align-items: center; }
      .item-head > div:not(:first-child) { justify-content: center; text-align: center; }
      .item-group-row { min-width: 0; background: #fff; }
      .item-group-row + .item-group-row { border-top: 1px solid ${borderColor}; }
      .item-group-compact { break-inside: avoid; page-break-inside: avoid; }
      .item-group-large { break-inside: auto; page-break-inside: auto; }
      .item-group-row > div { min-width: 0; }
      .column-quantity, .column-unit-price, .column-total { border-left: 1px solid ${borderColor}; }
      .item-group-title-cell { min-height: 36px; padding: 8px 20px 3px; display: flex; align-items: center; }
      .item-product-cell { direction: ltr; background: linear-gradient(100deg, ${softBackground}, #fff 42%); }
      .item-product-name { width: 100%; color: ${primaryDark}; font-size: 16.5px; line-height: 1.35; font-weight: 700; overflow-wrap: anywhere; unicode-bidi: plaintext; text-align: left; }
      .variant-cell { min-height: 37px; padding: 6px 20px; display: flex; align-items: center; break-inside: avoid; page-break-inside: avoid; }
      .variant-continuation { border-top: 1px dashed ${borderColor}; }
      .variant-product-cell { direction: ltr; background: linear-gradient(100deg, ${softBackground}, #fff 42%); }
      .variant-numeric-cell { justify-content: center; color: ${primaryDark}; font-size: 12px; line-height: 1.4; font-weight: 600; text-align: center; }
      .variant-options { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 7px; min-width: 0; color: ${primaryDark}; font-size: 11px; line-height: 1.45; }
      .variant-option { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; direction: ltr; }
      .variant-option-label { font-weight: 600; white-space: nowrap; unicode-bidi: plaintext; }
      .variant-option-value { min-width: 0; font-weight: 500; overflow-wrap: anywhere; unicode-bidi: plaintext; }
      .variant-separator { color: ${accentColor}; font-weight: 700; }
      .variant-empty { color: #5a6b82; font-size: 10.5px; font-style: italic; }
      .summary-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 22px; margin-top: 22px; align-items: stretch; break-inside: avoid; page-break-inside: avoid; }
      .summary-card, .payment-card { position: relative; min-height: 170px; padding-top: 38px; border: 1px solid ${borderColor}; border-radius: 12px; overflow: hidden; background: #fff; }
      .summary-card .section-heading { min-width: 188px; }
      .summary-body { padding: 11px 15px 15px; }
      .summary-line { display: flex; justify-content: space-between; gap: 18px; padding: 9px 2px; color: ${primaryDark}; border-bottom: 1px solid ${borderColor}; font-size: 10.5px; }
      .summary-line strong { color: ${primaryDark}; font-weight: 600; }
      .summary-line.offer-line, .summary-line.offer-line strong { color: #187342; }
      .summary-line .free-delivery { color: #15813f; }
      .summary-total { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-top: 11px; min-height: 53px; padding: 10px 13px; border: 1px solid ${accentColor}; border-radius: 8px; background: linear-gradient(120deg, #fffaf0, ${softBackground}); color: ${primaryDark}; }
      .total-label { font-size: 13px; font-weight: 700; }
      .total-value { margin-left: auto; color: ${accentColor}; font-size: 22px; font-weight: 700; text-align: right; white-space: nowrap; }
      .payment-card { background: linear-gradient(145deg, #fff, ${softBackground}); }
      .payment-card .section-heading { min-width: 209px; }
      .payment-content { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 16px; align-items: center; min-height: 129px; padding: 10px 18px 14px; }
      .payment-icon { width: 66px; height: 66px; display: flex; align-items: center; justify-content: center; border: 1.5px solid ${accentColor}; border-radius: 50%; background: #fff; color: ${primaryColor}; }
      .payment-icon svg { width: 39px; height: 39px; }
      .payment-value { color: ${primaryDark}; font-size: 15px; line-height: 1.2; font-weight: 700; }
      .payment-note { margin-top: 8px; color: #41536d; font-size: 11px; line-height: 1.45; }
      .keep-note { margin: 10px 0 0; padding: 8px 11px; border: 1px solid ${borderColor}; border-radius: 8px; background: #fff; color: #41536d; font-size: 9.5px; unicode-bidi: plaintext; }
      .information-strip { display: flex; align-items: center; gap: 10px; min-height: 35px; margin: 12px 0 11px; padding: 7px 12px; border: 1px solid ${borderColor}; border-radius: 9px; background: ${softBackground}; color: ${primaryDark}; font-size: 9.5px; }
      .information-strip svg { width: 18px; height: 18px; flex: 0 0 18px; color: ${primaryColor}; }
      .footer { margin: auto -10mm 0; min-height: 26mm; padding: 8px 10mm 9px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: center; background: linear-gradient(108deg, ${primaryDark}, ${primaryColor}); color: #fff; break-inside: avoid; page-break-inside: avoid; }
      .footer.no-social { grid-template-columns: 1fr; }
      .footer-thanks { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 17px; align-items: center; }
      .footer-heart { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; border: 1.5px solid ${accentColor}; border-radius: 50%; color: ${accentColor}; }
      .footer-heart svg { width: 31px; height: 31px; }
      .footer-main { font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.15; font-weight: 600; }
      .footer-title-accent { width: 38px; height: 1.5px; margin-top: 7px; background: ${accentColor}; }
      .footer-disclaimer { margin-top: 7px; max-width: 480px; font-size: 10px; line-height: 1.45; color: rgba(255,255,255,.9); }
      .footer-social { min-width: 205px; min-height: 60px; padding-left: 27px; border-left: 1px solid ${accentColor}; display: flex; align-items: center; justify-content: center; gap: 11px; color: #fff; font-size: 11px; }
      .footer-social-icon { width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; color: ${accentColor}; }
      .footer-social-icon svg { width: 31px; height: 31px; }
      .receipt-dense .header { min-height: 80px; }
      .receipt-dense .title-block { margin: 10px 0 12px; }
      .receipt-dense .meta { min-height: 66px; }
      .receipt-dense .top-grid { margin-top: 18px; }
      .receipt-dense .customer-list { min-height: 195px; padding-top: 42px; }
      .receipt-dense .customer-row { min-height: 35px; }
      .receipt-dense .product-panel { min-height: 195px; }
      .receipt-dense .product-visual { flex-basis: 193px; height: 193px; min-height: 193px; max-height: 193px; padding-top: 38px; }
      .receipt-dense .details { margin-top: 16px; padding-top: 39px; }
      .receipt-dense .details .section-heading { height: 40px; }
      .receipt-dense .item-head > div { padding-top: 9px; padding-bottom: 9px; }
      .receipt-dense .item-group-title-cell { min-height: 33px; padding-top: 6px; }
      .receipt-dense .variant-cell { min-height: 33px; padding-top: 4px; padding-bottom: 4px; }
      .receipt-dense .summary-grid { margin-top: 16px; }
      .receipt-dense .summary-body { padding-top: 8px; padding-bottom: 10px; }
      .receipt-dense .summary-line { padding-top: 5px; padding-bottom: 5px; }
      .receipt-dense .summary-total { min-height: 45px; margin-top: 8px; padding-top: 7px; padding-bottom: 7px; }
      .receipt-dense .information-strip { margin-bottom: 8px; }
      .receipt-extra-dense .title-block { margin-top: 8px; margin-bottom: 10px; }
      .receipt-extra-dense .meta { min-height: 62px; }
      .receipt-extra-dense .top-grid { margin-top: 16px; }
      .receipt-extra-dense .customer-list { min-height: 193px; padding-top: 37px; padding-bottom: 4px; }
      .receipt-extra-dense .customer-row { min-height: 31px; }
      .receipt-extra-dense .item-head > div { padding-top: 7px; padding-bottom: 7px; }
      .receipt-extra-dense .item-group-title-cell { min-height: 31px; padding-top: 5px; }
      .receipt-extra-dense .variant-cell { min-height: 31px; padding-top: 3px; padding-bottom: 3px; }
      .receipt-extra-dense .summary-body { padding-top: 6px; padding-bottom: 8px; }
      .receipt-extra-dense .summary-line { padding-top: 3px; padding-bottom: 3px; }
      .receipt-extra-dense .summary-total { min-height: 42px; margin-top: 6px; padding-top: 6px; padding-bottom: 6px; }
      .receipt-extra-dense .information-strip { margin-top: 8px; margin-bottom: 7px; }
      .receipt-multipage { min-height: 297mm; height: auto; overflow: visible; }
      .dynamic-value { unicode-bidi: plaintext; }
    </style>
  </head>
  <body>
    <main class="receipt-page${densityClass}${extraDensityClass}${paginationClass}">
      <header class="header${headerContacts ? "" : " no-contacts"}">
        <div class="brand">
          <div class="logo-wrap">${logoHtml}</div>
          <div>
            <div class="store-name dynamic-value" dir="auto">${escapeHtml(branding.storeName)}</div>
            ${branding.slogan ? `<div class="slogan dynamic-value" dir="auto">${escapeHtml(branding.slogan)}</div>` : ""}
            <div class="brand-accent"></div>
          </div>
        </div>
        ${headerContacts ? `<div class="header-contacts">${headerContacts}</div>` : ""}
      </header>

      <div class="title-block">
        <h1 class="title">REÇU DE COMMANDE</h1>
        <div class="title-ornament"><span class="ornament-line"></span><span class="ornament-diamond"></span><span class="ornament-line"></span></div>
      </div>

      <section class="meta">
        <div class="meta-item"><span class="meta-icon">${receiptIcon("order")}</span><div><span class="meta-label">Commande N°</span><span class="meta-value">${escapeHtml(model.referenceId)}</span></div></div>
        <div class="meta-item"><span class="meta-icon">${receiptIcon("calendar")}</span><div><span class="meta-label">Date</span><span class="meta-value">${escapeHtml(formatDate(model.confirmedAt, true))}</span></div></div>
        <div class="meta-item"><span class="meta-icon">${receiptIcon("status")}</span><div><span class="meta-label">Statut</span><span class="status-badge">${escapeHtml(model.statusLabel)}</span></div></div>
      </section>

      <section class="top-grid">
        <div class="panel">
          <h2 class="section-heading">${receiptIcon("customer")}<span>INFORMATIONS DU CLIENT</span></h2>
          <div class="customer-list">${customerRows}</div>
        </div>
        <div class="panel product-panel">
          <h2 class="section-heading">${receiptIcon("product")}<span>PRODUIT COMMANDÉ</span></h2>
          <div class="product-visual">${productVisual}</div>
        </div>
      </section>

      <section class="panel details">
        <h2 class="section-heading">${receiptIcon("cart")}<span>DÉTAILS DE LA COMMANDE</span></h2>
        <div class="item-grid item-head"><div>Produit</div><div>Quantité</div><div>Prix unitaire</div><div>Total</div></div>
        ${itemRows}
      </section>

      <section class="summary-grid">
        <div class="summary-card">
          <h2 class="section-heading">${receiptIcon("recap")}<span>RÉCAPITULATIF</span></h2>
          <div class="summary-body"><div class="summary-line"><span>Sous-total</span><strong>${escapeHtml(formatMoney(model.standardSubtotal, currency))}</strong></div>${offerRows}<div class="summary-line"><span>Frais de livraison</span><strong class="${model.deliveryFee?.type === "FREE" || model.deliveryFee?.amount === 0 ? "free-delivery" : ""}">${escapeHtml(deliveryText)}</strong></div><div class="summary-total"><span class="total-label">TOTAL FINAL</span><span class="total-value">${escapeHtml(totalText)}</span></div></div>
        </div>
        <div class="payment-card"><h2 class="section-heading">${receiptIcon("payment")}<span>MODE DE PAIEMENT</span></h2><div class="payment-content"><div class="payment-icon">${receiptIcon("payment")}</div><div><div class="payment-value">${escapeHtml(paymentMethod)}</div><div class="payment-note">Vous réglez le montant total au moment de la livraison.</div></div></div></div>
      </section>

      ${specificNote ? `<div class="keep-note" dir="auto">${escapeHtml(specificNote)}</div>` : ""}
      <div class="information-strip">${receiptIcon("info")}<span>Conservez ce reçu jusqu’à la confirmation de la livraison.</span></div>
      <footer class="footer${socialItems ? "" : " no-social"}"><div class="footer-thanks"><div class="footer-heart">${receiptIcon("heart")}</div><div><div class="footer-main">${escapeHtml(footerMessage)}</div><div class="footer-title-accent"></div><div class="footer-disclaimer">Ce document confirme l’enregistrement de votre commande.<br />Il ne constitue pas une facture acquittée.</div></div></div>${socialItems}</footer>
    </main>
  </body>
</html>`;
}

/**
 * Shared, in-memory PDF adapter for guarded Preview flows. It never writes or
 * dispatches a document, while keeping Puppeteer configuration consistent with
 * the established receipt renderer.
 */
export async function renderOrderReceiptHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map(
          (image) =>
            image.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  image.addEventListener("load", () => resolve(), { once: true });
                  image.addEventListener("error", () => resolve(), { once: true });
                }),
        ),
      );
    });
    return Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
  } finally {
    await browser.close();
  }
}

/** The single customer-facing premium receipt engine for every confirmed order path. */
export async function renderPremiumOrderReceiptPdfBuffer(
  model: PremiumOrderReceiptViewModel,
): Promise<Buffer> {
  if (model.rendererId !== PREMIUM_ORDER_RECEIPT_RENDERER_ID) {
    throw new Error("Unsupported receipt renderer");
  }
  return renderOrderReceiptHtmlToPdfBuffer(
    await buildPremiumOrderReceiptHtml(model),
  );
}

export async function generateOrderReceiptPdf(
  order: OrderReceiptOrder,
): Promise<GenerateReceiptResult> {
  if (!env.orderReceiptPdfEnabled) {
    recordOrderReceiptSkipped({
      orderId: order.id,
      status: "SKIPPED",
    });

    return {
      ok: false,
      exists: false,
      sizeBytes: 0,
      errorMessage: "Order receipt PDF generation is disabled",
    };
  }

  const validation = validateConfirmedOrderReceiptSnapshot(order);

  if (!validation.valid) {
    return {
      ok: false,
      exists: false,
      sizeBytes: 0,
      errorMessage: "Confirmed order receipt snapshot is structurally invalid",
      errorCode: validation.errorCode,
      invalidFields: validation.invalidFields,
    };
  }

  const pdfPath = getOrderReceiptPdfPath(order.id, order.publicOrderCode);

  try {
    await fs.mkdir(path.dirname(pdfPath), { recursive: true });

    if (await fileExists(pdfPath)) {
      return {
        ok: true,
        pdfPath,
        exists: true,
        sizeBytes: await getFileSize(pdfPath),
      };
    }

    await fs.writeFile(
      pdfPath,
      await renderPremiumOrderReceiptPdfBuffer(buildLegacyPremiumReceiptModel(order)),
    );

    const sizeBytes = await getFileSize(pdfPath);

    diagnostics.totalOrderReceiptPdfGenerated += 1;
    receiptRecords.set(order.id, {
      orderId: order.id,
      pdfPath,
      sendStatus: receiptRecords.get(order.id)?.sendStatus || "SKIPPED",
    });
    logJson({
      event: "order_receipt.pdf.generated",
      orderId: order.id,
      pdfPath,
      sizeBytes,
    });

    return {
      ok: true,
      pdfPath,
      exists: true,
      sizeBytes,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    diagnostics.totalOrderReceiptPdfFailed += 1;
    logJson({
      event: "order_receipt.pdf.generate_failed",
      orderId: order.id,
      errorMessage,
    });

    return {
      ok: false,
      pdfPath,
      exists: await fileExists(pdfPath),
      sizeBytes: await getFileSize(pdfPath),
      errorMessage,
    };
  }
}

export function buildSampleReceiptOrder(): OrderReceiptOrder {
  const confirmedAt = "2026-07-12T00:07:00.000Z";
  const sampleSuffix = String(Date.now()).slice(-4);

  return {
    id: `sample-${Date.now()}`,
    publicOrderCode: `KQMT-${sampleSuffix}`,
    customerId: "sample-customer",
    orderCycleId: `sample-cycle-${sampleSuffix}`,
    productName: "صندالة نسائية",
    fullName: "عمر",
    phone: "0612345678",
    city: "مراكش",
    address: "حي السلام",
    size: "40",
    color: "وردي",
    quantity: 2,
    unitPrice: 199,
    subtotal: 398,
    deliveryPrice: 0,
    deliveryPriceKnown: true,
    total: 398,
    currency: "درهم",
    deliveryQuote: {
      status: "RESOLVED",
      type: "FREE",
      amount: 0,
      currency: "MAD",
      inputCity: "مراكش",
      canonicalCity: "مراكش",
      ruleId: "sample-free-delivery",
      resolvedAt: confirmedAt,
    },
    pricing: {
      status: "COMPLETE",
      unitPrice: 199,
      quantity: 2,
      subtotal: 398,
      deliveryPrice: 0,
      total: 398,
      currency: "MAD",
    },
    status: "CONFIRMED",
    source: "agent",
    confirmedAt,
    createdAt: confirmedAt,
    updatedAt: confirmedAt,
    receiptBranding: {
      storeName: "Élégance Boutique",
      slogan: "Style, qualité et confiance",
      logoUrl: "src/modules/order-receipt/fixtures/demo-logo.svg",
      primaryColor: "#062E67",
      secondaryColor: "#F4F8FD",
      accentColor: "#C78A22",
      phone: "06 00 00 00 00",
      email: "contact@example.com",
      address: "Marrakech, Maroc",
      instagram: "@eleganceboutique",
      footerMessage: "Merci pour votre commande !",
      paymentMethodLabel: "Paiement à la livraison",
    },
    receiptProduct: {
      imageRef: "src/modules/order-receipt/fixtures/demo-sandal-product-cropped.png",
      requiredAttributeKeys: ["size", "color"],
      attributes: [
        { key: "size", label: "Taille", value: "40", canonicalValue: "40" },
        { key: "color", label: "Couleur", value: "وردي", canonicalValue: "وردي" },
      ],
    },
  };
}
