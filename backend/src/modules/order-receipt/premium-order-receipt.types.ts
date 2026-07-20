export const PREMIUM_ORDER_RECEIPT_RENDERER_ID = "approved-premium-receipt-v1" as const;

export type PremiumReceiptBranding = Readonly<{
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
}>;

export type PremiumReceiptItem = Readonly<{
  /** Opaque presentation-group identity. It is never rendered to the receipt. */
  productGroupKey?: string;
  productName: string;
  quantity: number;
  options: readonly Readonly<{
    label: string;
    value: string;
  }>[];
  unitPrice: number;
  lineTotal: number;
  imageRef?: string;
}>;

export type PremiumReceiptCustomerField = Readonly<{
  key?: string;
  label: string;
  value: string;
}>;

export type PremiumOrderReceiptViewModel = Readonly<{
  schemaVersion: 1;
  rendererId: typeof PREMIUM_ORDER_RECEIPT_RENDERER_ID;
  referenceId: string;
  storeName: string;
  confirmedAt: string;
  statusLabel: string;
  branding: PremiumReceiptBranding;
  lines: readonly PremiumReceiptItem[];
  deliveryFields: readonly PremiumReceiptCustomerField[];
  currency: string;
  standardSubtotal: number;
  selectedOffer?: Readonly<{
    label: string;
    discountAmount: number;
    total: number;
  }>;
  merchandiseTotal: number;
  deliveryFee?: Readonly<{
    type: "FREE" | "PAID";
    amount: number;
    currency: string;
  }>;
  finalTotal: number;
  paymentMethodLabel?: string;
  deliveryText?: string;
  productImageRef?: string;
  footerMessage?: string;
  notes?: string;
}>;
