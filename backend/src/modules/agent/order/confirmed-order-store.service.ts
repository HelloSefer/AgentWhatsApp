import { randomUUID } from "node:crypto";
import type { OrderEntities } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";
import { productContextService } from "../config/product-context.service";
import { sellerConfigService } from "../config/seller-config.service";
import { calculateOrderTotals } from "./order-pricing.service";
import type { ResolvedDeliveryQuote } from "./delivery-pricing.service";
import type { CartDraft } from "./cart-state.types";

export const orderStatuses = [
  "CONFIRMED",
  "PREPARING",
  "SENT",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type OrderReceiptSendStatus =
  | "NOT_REQUESTED"
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export type OrderReceiptErrorCode = "RECEIPT_DATA_INVALID";

export type ReceiptBrandingSnapshot = {
  storeName: string;
  slogan?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  address?: string;
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  footerMessage?: string;
  paymentMethodLabel?: string;
};

export type ReceiptProductSnapshot = {
  imageRef?: string;
  attributes: Array<{
    key?: string;
    label: string;
    value: string;
    canonicalValue?: string;
  }>;
  requiredAttributeKeys?: string[];
};

/** Internal compatibility snapshot only; single-item receipts still use the legacy projection. */
export type ConfirmedOrderCartItemSnapshot = {
  id: string;
  productId: string;
  quantity: number;
  selectedOptions: Record<string, string | number | boolean>;
};

export interface ConfirmedOrder {
  id: string;
  publicOrderCode: string;
  customerId: string;
  orderCycleId: string;
  sellerId?: string;
  customerPhone?: string;
  conversationKey?: string;
  productId?: string;
  productName: string;
  fullName: string;
  phone: string;
  city: string;
  address: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  deliveryPrice: number;
  deliveryPriceKnown: boolean;
  total: number;
  currency: string;
  deliveryQuote: ResolvedDeliveryQuote;
  pricing: {
    status: "COMPLETE";
    unitPrice: number;
    quantity: number;
    subtotal: number;
    deliveryPrice: number;
    total: number;
    currency: string;
  };
  status: OrderStatus;
  source: "agent" | "whatsapp_cloud";
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
  receiptPdfPath?: string;
  receiptSentAt?: string;
  receiptMediaId?: string;
  receiptSendStatus?: OrderReceiptSendStatus;
  receiptError?: string;
  receiptErrorCode?: OrderReceiptErrorCode;
  receiptInvalidFields?: string[];
  receiptLocalFileDeleted?: boolean;
  receiptLocalFileDeletedAt?: string;
  receiptLocalFileDeleteError?: string;
  receiptBranding?: ReceiptBrandingSnapshot;
  receiptProduct?: ReceiptProductSnapshot;
  cartItems?: ConfirmedOrderCartItemSnapshot[];
}

type SaveConfirmedOrderInput = {
  customerId: string;
  orderCycleId?: string;
  sellerId?: string;
  customerPhone?: string;
  conversationKey?: string;
  productContext: ProductContext;
  collected: OrderEntities;
  deliveryQuote: ResolvedDeliveryQuote;
  cart?: CartDraft;
  source?: "agent" | "whatsapp_cloud";
};

type ListConfirmedOrdersFilters = {
  status?: OrderStatus;
  customerId?: string;
  phone?: string;
  city?: string;
};

const confirmedOrdersById = new Map<string, ConfirmedOrder>();
const confirmedOrderIdsByOrderKey = new Map<string, string>();

function getOrderKey(customerId: string, orderCycleId: string): string {
  return `${customerId}:${orderCycleId}`;
}

const PUBLIC_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generatePublicOrderCode(): string {
  const existingCodes = new Set(
    Array.from(confirmedOrdersById.values()).map(
      (order) => order.publicOrderCode,
    ),
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const raw = randomUUID().replace(/-/g, "").toUpperCase();
    let code = "";

    for (let index = 0; index < 8; index += 1) {
      const value = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
      code += PUBLIC_CODE_ALPHABET[value % PUBLIC_CODE_ALPHABET.length];
    }

    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;

    if (!existingCodes.has(formatted)) {
      return formatted;
    }
  }

  throw new Error("Unable to generate a unique public order code");
}

function getTextValue(value: string | undefined): string {
  return value?.trim() || "";
}

function getReceiptAttributeLabel(key: string, configuredLabel: string): string {
  const standardLabels: Record<string, string> = {
    size: "Taille",
    color: "Couleur",
    variant: "Variante",
    model: "Modèle",
    perfume: "Parfum",
    scent: "Parfum",
    capacity: "Capacité",
    volume: "Volume",
    format: "Format",
  };

  return standardLabels[key.trim().toLowerCase()] || configuredLabel;
}

function normalizeOptionValue(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

function buildReceiptSnapshots(input: SaveConfirmedOrderInput): {
  branding: ReceiptBrandingSnapshot;
  product: ReceiptProductSnapshot;
} {
  const sellerConfig = input.sellerId
    ? sellerConfigService.getSellerConfig(input.sellerId)
    : undefined;
  const branding = sellerConfig?.receipt.branding;
  const configProduct = input.productContext.productId
    ? productContextService.getProductContextById(input.productContext.productId)
    : undefined;
  const configuredOptions = configProduct?.optionGroups || [];
  const collected = input.collected as Record<string, unknown>;
  const attributes = configuredOptions.flatMap((option) => {
    const value = collected[option.key];

    const buildAttribute = (displayValue: string) => {
      const canonicalValue = option.options.find(
        (candidate) =>
          normalizeOptionValue(candidate) === normalizeOptionValue(displayValue),
      );

      return {
        key: option.key,
        label: getReceiptAttributeLabel(option.key, option.label),
        value: displayValue,
        canonicalValue,
      };
    };

    return typeof value === "string" && value.trim()
      ? [buildAttribute(value.trim())]
      : typeof value === "number" && Number.isFinite(value)
        ? [buildAttribute(String(value))]
        : [];
  });

  if (!attributes.some((attribute) => attribute.label === "Taille") && input.collected.size) {
    attributes.push({
      key: "size",
      label: "Taille",
      value: input.collected.size,
      canonicalValue: input.collected.size,
    });
  }

  if (!attributes.some((attribute) => attribute.label === "Couleur") && input.collected.color) {
    attributes.push({
      key: "color",
      label: "Couleur",
      value: input.collected.color,
      canonicalValue: input.collected.color,
    });
  }

  return {
    branding: {
      storeName: branding?.storeName || sellerConfig?.businessName || "Boutique",
      slogan: branding?.slogan,
      logoUrl: branding?.logoUrl,
      primaryColor: branding?.primaryColor,
      secondaryColor: branding?.secondaryColor,
      accentColor: branding?.accentColor,
      phone: branding?.phone,
      whatsapp: branding?.whatsapp,
      email: branding?.email,
      website: branding?.website,
      address: branding?.address,
      instagram: branding?.instagram,
      facebook: branding?.facebook,
      tiktok: branding?.tiktok,
      footerMessage: sellerConfig?.receipt.footerText,
      paymentMethodLabel: sellerConfig?.receipt.paymentMethodLabel,
    },
    product: {
      imageRef: configProduct?.images.find(Boolean),
      attributes,
      requiredAttributeKeys: configuredOptions
        .filter((option) => option.required)
        .map((option) => option.key),
    },
  };
}

function buildCartItemSnapshots(cart: CartDraft | undefined): ConfirmedOrderCartItemSnapshot[] | undefined {
  if (!cart?.items.length) {
    return undefined;
  }

  return cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    selectedOptions: { ...item.selectedOptions },
  }));
}

function matchesOptionalFilter(value: string, filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }

  return value.trim().toLowerCase() === filter.trim().toLowerCase();
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    orderStatuses.includes(value.trim().toUpperCase() as OrderStatus)
  );
}

export function normalizeOrderStatus(value: string): OrderStatus {
  return value.trim().toUpperCase() as OrderStatus;
}

export function saveConfirmedOrder(input: SaveConfirmedOrderInput): ConfirmedOrder {
  const orderCycleId = input.orderCycleId?.trim() || randomUUID();

  if (!input.orderCycleId?.trim()) {
    console.warn(JSON.stringify({
      event: "order.confirmed.missing_order_cycle_id_generated",
      customerId: input.customerId,
      orderCycleId,
    }));
  }

  const orderKey = getOrderKey(input.customerId, orderCycleId);
  const existingOrderId = confirmedOrderIdsByOrderKey.get(orderKey);
  const existingOrder = existingOrderId
    ? confirmedOrdersById.get(existingOrderId)
    : undefined;

  if (existingOrder) {
    return existingOrder;
  }

  const quantity = input.collected.quantity ?? 1;
  const deliveryQuote = input.deliveryQuote;

  const totals = calculateOrderTotals({
    productContext: input.productContext,
    quantity,
    deliveryQuote,
  });

  if (totals.status !== "COMPLETE") {
    throw new Error("Cannot save confirmed order with incomplete pricing.");
  }
  const receiptSnapshots = buildReceiptSnapshots(input);
  const confirmedAt = new Date().toISOString();
  const order: ConfirmedOrder = {
    id: randomUUID(),
    publicOrderCode: generatePublicOrderCode(),
    customerId: input.customerId,
    orderCycleId,
    sellerId: input.sellerId,
    customerPhone: input.customerPhone,
    conversationKey: input.conversationKey,
    productId: input.productContext.productId,
    productName: input.productContext.productName,
    fullName: getTextValue(input.collected.fullName),
    phone: getTextValue(input.collected.phone),
    city: getTextValue(input.collected.city),
    address: getTextValue(input.collected.address),
    size: getTextValue(input.collected.size),
    color: getTextValue(input.collected.color),
    quantity,
    unitPrice: totals.unitPrice,
    subtotal: totals.subtotal,
    deliveryPrice: totals.deliveryPrice,
    deliveryPriceKnown: totals.deliveryPriceKnown,
    total: totals.total,
    currency: totals.currency,
    deliveryQuote: { ...deliveryQuote },
    pricing: {
      status: "COMPLETE",
      unitPrice: totals.unitPrice,
      quantity: totals.quantity,
      subtotal: totals.subtotal,
      deliveryPrice: totals.deliveryPrice,
      total: totals.total,
      currency: deliveryQuote.currency,
    },
    status: "CONFIRMED",
    source: input.source || "agent",
    confirmedAt,
    receiptSendStatus: "NOT_REQUESTED",
    receiptBranding: receiptSnapshots.branding,
    receiptProduct: receiptSnapshots.product,
    cartItems: buildCartItemSnapshots(input.cart),
    createdAt: confirmedAt,
    updatedAt: confirmedAt,
  };

  confirmedOrdersById.set(order.id, order);
  confirmedOrderIdsByOrderKey.set(orderKey, order.id);

  return order;
}

export function getConfirmedOrderByCustomerId(
  customerId: string,
  orderCycleId?: string,
): ConfirmedOrder | undefined {
  if (orderCycleId) {
    const orderId = confirmedOrderIdsByOrderKey.get(
      getOrderKey(customerId, orderCycleId),
    );

    return orderId ? confirmedOrdersById.get(orderId) : undefined;
  }

  return Array.from(confirmedOrdersById.values())
    .filter((order) => order.customerId === customerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function listConfirmedOrders(
  filters: ListConfirmedOrdersFilters = {},
): ConfirmedOrder[] {
  return Array.from(confirmedOrdersById.values()).filter((order) => {
    if (filters.status && order.status !== filters.status) {
      return false;
    }

    return (
      matchesOptionalFilter(order.customerId, filters.customerId) &&
      matchesOptionalFilter(order.phone, filters.phone) &&
      matchesOptionalFilter(order.city, filters.city)
    );
  });
}

export function getConfirmedOrderById(id: string): ConfirmedOrder | undefined {
  return confirmedOrdersById.get(id);
}

export function updateConfirmedOrderStatus(
  id: string,
  status: OrderStatus,
): ConfirmedOrder | undefined {
  const order = getConfirmedOrderById(id);

  if (!order) {
    return undefined;
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();

  return order;
}

export function updateConfirmedOrderReceipt(
  id: string,
  receipt: {
    receiptPdfPath?: string;
    receiptSentAt?: string;
    receiptMediaId?: string;
    receiptSendStatus?: OrderReceiptSendStatus;
    receiptError?: string;
    receiptErrorCode?: OrderReceiptErrorCode;
    receiptInvalidFields?: string[];
    receiptLocalFileDeleted?: boolean;
    receiptLocalFileDeletedAt?: string;
    receiptLocalFileDeleteError?: string;
  },
): ConfirmedOrder | undefined {
  const order = getConfirmedOrderById(id);

  if (!order) {
    return undefined;
  }

  Object.assign(order, receipt);
  order.updatedAt = new Date().toISOString();

  return order;
}
