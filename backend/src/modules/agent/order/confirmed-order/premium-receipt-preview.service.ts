import fs from "node:fs/promises";
import path from "node:path";
import {
  buildPremiumOrderReceiptHtml,
  getOrderReceiptOutputDir,
  renderPremiumOrderReceiptPdfBuffer,
} from "../../../order-receipt/order-receipt.service";
import type { PremiumOrderReceiptViewModel } from "../../../order-receipt/premium-order-receipt.types";
import { buildConfirmedOrderReceiptModel } from "./confirmed-order-receipt.service";
import type { ConfirmedOrderSnapshot } from "./confirmed-order-snapshot.types";

export type PremiumReceiptPreviewArtifact = Readonly<{
  pdfPath: string;
  pngPath: string;
  pdfByteLength: number;
}>;

export type PremiumReceiptPreviewSet = Readonly<{
  oneItem: PremiumReceiptPreviewArtifact;
  twoVariants: PremiumReceiptPreviewArtifact;
  offerAndDelivery: PremiumReceiptPreviewArtifact;
}>;

const BRANDING = {
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
} as const;
const PRODUCT_IMAGE = "src/modules/order-receipt/fixtures/demo-sandal-product-cropped.png";
const CONFIRMED_AT = "2026-07-20T10:44:00.000Z";

function item(input: {
  id: string;
  productId?: string;
  productName?: string;
  quantity: number;
  size?: string;
  color?: string;
  extraOptions?: readonly Readonly<{ key: string; label: string; value: string }>[];
  unitPriceMinor?: number;
}): ConfirmedOrderSnapshot["items"][number] {
  const unitPriceMinor = input.unitPriceMinor ?? 19_900;
  return {
    itemId: input.id,
    productId: input.productId || "prod_demo_sandal_001",
    productName: input.productName || "صندالة نسائية",
    quantity: input.quantity,
    selectedOptions: [
      ...(input.size ? [{ key: "size", label: "Taille", value: input.size }] : []),
      ...(input.color ? [{ key: "color", label: "Couleur", value: input.color }] : []),
      ...(input.extraOptions || []),
    ],
    unitPriceMinor,
    lineTotalMinor: unitPriceMinor * input.quantity,
    unitPrice: unitPriceMinor / 100,
    lineTotal: (unitPriceMinor * input.quantity) / 100,
  };
}

function snapshot(input: {
  id: string;
  items: ConfirmedOrderSnapshot["items"];
  selectedOffer?: ConfirmedOrderSnapshot["selectedOffer"];
  deliveryFee: NonNullable<ConfirmedOrderSnapshot["deliveryFee"]>;
  extraField?: Readonly<{ key: string; label: string; value: string }>;
}): ConfirmedOrderSnapshot {
  const standardSubtotalMinor = input.items.reduce(
    (total, entry) => total + entry.lineTotalMinor,
    0,
  );
  const merchandiseTotalMinor = input.selectedOffer?.offerTotalMinor ?? standardSubtotalMinor;
  return {
    schemaVersion: 1,
    id: input.id,
    sellerId: "internal-premium-preview-seller",
    conversationScopeId: "internal-premium-preview-conversation",
    confirmedAt: CONFIRMED_AT,
    product: {
      productId: "prod_demo_sandal_001",
      name: "صندالة نسائية",
    },
    receiptContext: {
      storeName: BRANDING.storeName,
      paymentMethodLabel: "Paiement à la livraison",
      deliveryText: "Livraison disponible au Maroc",
      footerMessage: "Merci pour votre commande !",
      productImageRef: PRODUCT_IMAGE,
      branding: BRANDING,
    },
    items: input.items,
    completedUnits: input.items.reduce((total, entry) => total + entry.quantity, 0),
    targetUnits: input.items.reduce((total, entry) => total + entry.quantity, 0),
    orderFields: [
      { key: "fullName", label: "Nom complet", value: "عمر العلوي" },
      { key: "phone", label: "Téléphone", value: "0612345678" },
      { key: "city", label: "Ville", value: "مراكش" },
      {
        key: "address",
        label: "Adresse",
        value: "حي السلام، زنقة الأمل رقم 12 قرب مسجد النور",
      },
      ...(input.extraField ? [input.extraField] : []),
    ],
    currency: "MAD",
    standardSubtotalMinor,
    standardSubtotal: standardSubtotalMinor / 100,
    ...(input.selectedOffer ? { selectedOffer: input.selectedOffer } : {}),
    merchandiseTotalMinor,
    merchandiseTotal: merchandiseTotalMinor / 100,
    deliveryFee: input.deliveryFee,
    finalTotalMinor: merchandiseTotalMinor + input.deliveryFee.amountMinor,
    finalTotal: (merchandiseTotalMinor + input.deliveryFee.amountMinor) / 100,
    commercialWarnings: [],
  };
}

function modelFromSnapshot(value: ConfirmedOrderSnapshot): PremiumOrderReceiptViewModel {
  const result = buildConfirmedOrderReceiptModel(value);
  if (!result.success || !result.receiptModel) {
    throw new Error(`Unable to build premium receipt model: ${result.failureCode || "unknown"}`);
  }
  return result.receiptModel;
}

export function buildPremiumReceiptPreviewModels(): Readonly<{
  oneItem: PremiumOrderReceiptViewModel;
  twoVariants: PremiumOrderReceiptViewModel;
  offerAndDelivery: PremiumOrderReceiptViewModel;
}> {
  const freeDelivery = {
    type: "FREE" as const,
    amountMinor: 0,
    amount: 0,
    currency: "MAD",
  };
  const oneItem = snapshot({
    id: "R3-ONE-ITEM",
    items: [item({ id: "internal-one", quantity: 2, size: "40", color: "وردي" })],
    deliveryFee: freeDelivery,
  });
  const twoVariants = snapshot({
    id: "R3-TWO-VARIANTS",
    items: [
      item({ id: "internal-pink-38", quantity: 1, size: "38", color: "وردي" }),
      item({ id: "internal-black-39", quantity: 1, size: "39", color: "أسود" }),
    ],
    deliveryFee: freeDelivery,
  });
  const offerAndDelivery = snapshot({
    id: "R3-OFFER-DELIVERY",
    items: [
      item({ id: "internal-offer-one", quantity: 2, size: "38", color: "وردي" }),
      item({
        id: "internal-offer-two",
        productId: "prod_demo_sandal_002",
        productName: "صندالة نسائية - موديل كلاسيكي",
        quantity: 1,
        size: "39",
        color: "أسود",
        extraOptions: [{ key: "finish", label: "Finition", value: "Mat" }],
      }),
    ],
    selectedOffer: {
      offerId: "internal-bundle-three-id",
      label: "Offre 3 pièces",
      offerTotalMinor: 49_900,
      discountMinor: 9_800,
      offerTotal: 499,
      discountAmount: 98,
    },
    deliveryFee: {
      type: "PAID",
      amountMinor: 3_500,
      amount: 35,
      currency: "MAD",
    },
    extraField: {
      key: "deliveryInstructions",
      label: "Instructions",
      value: "المرجو الاتصال قبل التوصيل",
    },
  });

  return {
    oneItem: modelFromSnapshot(oneItem),
    twoVariants: modelFromSnapshot(twoVariants),
    offerAndDelivery: modelFromSnapshot(offerAndDelivery),
  };
}

async function renderHtmlFirstPagePng(html: string, outputPath: string): Promise<void> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });
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
    await fs.writeFile(
      outputPath,
      Buffer.from(await page.screenshot({ type: "png", fullPage: false })),
    );
  } finally {
    await browser.close();
  }
}

export async function generatePremiumReceiptPreviews(): Promise<PremiumReceiptPreviewSet> {
  const models = buildPremiumReceiptPreviewModels();
  const outputDir = path.join(getOrderReceiptOutputDir(), "previews");
  await fs.mkdir(outputDir, { recursive: true });

  const render = async (
    key: keyof typeof models,
    filename: string,
  ): Promise<PremiumReceiptPreviewArtifact> => {
    const model = models[key];
    const pdfPath = path.join(outputDir, `${filename}.pdf`);
    const pngPath = path.join(outputDir, `${filename}.png`);
    const [pdfBuffer, html] = await Promise.all([
      renderPremiumOrderReceiptPdfBuffer(model),
      buildPremiumOrderReceiptHtml(model),
    ]);
    await fs.writeFile(pdfPath, pdfBuffer);
    await renderHtmlFirstPagePng(html, pngPath);
    return { pdfPath, pngPath, pdfByteLength: pdfBuffer.length };
  };

  return {
    oneItem: await render("oneItem", "premium-receipt-one-item"),
    twoVariants: await render("twoVariants", "premium-receipt-two-variants"),
    offerAndDelivery: await render("offerAndDelivery", "premium-receipt-offer-delivery"),
  };
}
