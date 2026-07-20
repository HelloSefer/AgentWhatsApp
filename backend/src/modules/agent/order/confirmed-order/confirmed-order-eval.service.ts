import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { evaluateCartCommercialIntegration } from "../commercial/cart-commercial-evaluation-eval.service";
import type { CartDraft, CartItem } from "../cart-state.types";
import { evaluateCartPricing } from "../pricing/cart-pricing-eval.service";
import { evaluateDeliveryConfirmation } from "../delivery-confirmation/delivery-confirmation-eval.service";
import type {
  ConfirmedOrderPreview,
  DeliveryConfirmationPreviewState,
} from "../delivery-confirmation/delivery-confirmation.types";
import { buildConfirmedOrderReceiptModel, generateConfirmedOrderReceiptPreviewPdf } from "./confirmed-order-receipt.service";
import { createConfirmedOrderSnapshot } from "./confirmed-order-snapshot.service";
import type { ConfirmedOrderSnapshotInput } from "./confirmed-order-snapshot.types";

type EvaluationCase = Readonly<{ name: string; passed: boolean; detail?: string }>;

export type ConfirmedOrderEvaluationResult = Readonly<{
  summary: Readonly<{ total: number; passed: number; failed: number; passedAll: boolean }>;
  cases: readonly EvaluationCase[];
}>;

const SELLER_ID = "confirmed-order-seller";
const PRODUCT_ID = "confirmed-order-product";
const SCOPE_ID = "preview-customer-0612345678";
const SNAPSHOT_ID = "test-order-001";
const CONFIRMED_AT = "2026-07-19T00:00:00.000Z";
const NOW = new Date("2026-07-19T16:00:00.000Z");

const fields: RequiredOrderField[] = [
  { key: "size", label: "Taille", required: true, enabled: true, source: "productOption", askOrder: 1, captureMode: "CONFIGURED_ENUM", options: ["36", "38", "40"] },
  { key: "color", label: "Couleur", required: true, enabled: true, source: "productOption", askOrder: 2, captureMode: "CONFIGURED_ENUM", options: ["وردي", "أسود"] },
  { key: "material", label: "Matière", required: false, enabled: true, source: "productOption", askOrder: 3, captureMode: "CONFIGURED_ENUM", options: ["Cuir", "Tissu"], requirement: "OPTIONAL" },
  { key: "fullName", label: "Nom complet", required: true, enabled: true, source: "customerField", askOrder: 10, semanticType: "PERSON_NAME", captureMode: "OPEN_TEXT" },
  { key: "phone", label: "Téléphone", required: true, enabled: true, source: "customerField", askOrder: 20, semanticType: "PHONE", captureMode: "PHONE" },
  { key: "city", label: "Ville", required: true, enabled: true, source: "customerField", askOrder: 30, semanticType: "LOCATION", captureMode: "LOCATION" },
  { key: "address", label: "Adresse", required: true, enabled: true, source: "customerField", askOrder: 40, semanticType: "ADDRESS", captureMode: "ADDRESS" },
  { key: "deliveryInstructions", label: "Instructions", required: false, enabled: true, source: "customerField", askOrder: 50, captureMode: "OPEN_TEXT", requirement: "OPTIONAL" },
];

function product(overrides: Partial<ProductContext> = {}): ProductContext {
  return {
    sellerId: SELLER_ID,
    productId: PRODUCT_ID,
    name: "صندالة نسائية Premium Sandal",
    price: 199,
    currency: "MAD",
    active: true,
    images: [],
    benefits: [],
    optionGroups: [
      { key: "size", label: "Taille", required: true, options: ["36", "38", "40"], display: "buttons" },
      { key: "color", label: "Couleur", required: true, options: ["وردي", "أسود"], display: "buttons" },
      { key: "material", label: "Matière", required: false, options: ["Cuir", "Tissu"], display: "buttons", requirement: "OPTIONAL" },
    ],
    infoMenu: [],
    stock: { enabled: false, status: "AVAILABLE" },
    offers: [
      {
        id: "bundle-three",
        productId: PRODUCT_ID,
        label: "عرض ثلاثة",
        requiredItemCount: 3,
        totalPrice: 499,
        currency: "MAD",
        active: true,
        allowMixedOptions: true,
        priority: 1,
      },
    ],
    ...overrides,
  };
}

function item(input: Partial<CartItem> = {}): CartItem {
  return {
    id: "confirmed-line-one",
    productId: PRODUCT_ID,
    quantity: 1,
    selectedOptions: { size: "38", color: "أسود", material: "Cuir" },
    status: "COMPLETE",
    ...input,
  };
}

function cart(overrides: Partial<CartDraft> = {}): CartDraft {
  const items = overrides.items || [
    item({ id: "confirmed-line-one", quantity: 1, selectedOptions: { size: "38", color: "أسود", material: "Cuir" } }),
    item({ id: "confirmed-line-two", quantity: 2, selectedOptions: { size: "40", color: "وردي", material: "Tissu" } }),
  ];
  return {
    schemaVersion: 1,
    mode: "OFFER",
    status: "CONFIRMED",
    targetItemCount: items.reduce((total, entry) => total + entry.quantity, 0),
    selectedOfferId: "bundle-three",
    items,
    orderLevelFields: {
      fullName: "Oussama El Amrani",
      phone: "0612345678",
      city: "دوار النخيل الجديدة",
      address: "résidence Al Amal appartement 6",
      deliveryInstructions: "قرب مسجد النور",
    },
    ...overrides,
  };
}

function preview(currentCart: CartDraft, currentFields: readonly RequiredOrderField[] = fields): ConfirmedOrderPreview {
  const itemFields = new Map(
    currentFields
      .filter((field) => field.source === "productOption")
      .map((field) => [field.key, field]),
  );
  const orderFields = currentFields
    .filter((field) => field.source === "customerField")
    .filter((field) => currentCart.orderLevelFields[field.key] !== undefined)
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: currentCart.orderLevelFields[field.key]!,
    }));

  return {
    sellerId: SELLER_ID,
    conversationScopeId: SCOPE_ID,
    items: currentCart.items.map((entry) => ({
      id: entry.id,
      productId: entry.productId,
      productName: "Untrusted product label",
      quantity: entry.quantity,
      options: Object.entries(entry.selectedOptions).map(([key, value]) => ({
        key,
        label: itemFields.get(key)?.label || key,
        value,
      })),
      unitPriceMinor: 1,
      lineTotalMinor: entry.quantity,
      unitPrice: 0.01,
      lineTotal: entry.quantity / 100,
    })),
    completedUnits: currentCart.items.reduce((total, entry) => total + entry.quantity, 0),
    orderFields,
    // Deliberately untrusted request-style values. Snapshot pricing must ignore them.
    standardSubtotalMinor: 100,
    standardSubtotal: 1,
    currency: "USD",
    selectedOffer: currentCart.selectedOfferId
      ? {
          offerId: currentCart.selectedOfferId,
          totalMinor: 100,
          total: 1,
          discountMinor: 0,
          discountAmount: 0,
        }
      : undefined,
    merchandiseTotalMinor: 100,
    merchandiseTotal: 1,
    finalTotalMinor: 100,
    finalTotal: 1,
    confirmedAt: CONFIRMED_AT,
  };
}

function input(overrides: Partial<ConfirmedOrderSnapshotInput> = {}): ConfirmedOrderSnapshotInput {
  const productContext = overrides.productContext || product();
  const requiredFields = overrides.requiredFields || fields;
  const currentCart = overrides.cart || cart();
  const offerLookup = overrides.offerLookup || new OfferConfigService().getConfiguredOffers({
    sellerId: productContext.sellerId,
    productId: productContext.productId,
    productContexts: [productContext],
  });
  const previewState: DeliveryConfirmationPreviewState = {
    version: 1,
    kind: "CONFIRMED_PREVIEW",
    confirmedAt: CONFIRMED_AT,
  };

  return {
    previewEnabled: true,
    cart: currentCart,
    previewState,
    confirmedPreview: preview(currentCart, requiredFields),
    sellerId: productContext.sellerId,
    conversationScopeId: SCOPE_ID,
    productContext,
    requiredFields,
    offerLookup,
    receiptContext: {
      storeName: "Élégance Boutique",
      paymentMethodLabel: "Paiement à la livraison",
      deliveryText: "Livraison disponible au Maroc",
    },
    now: NOW,
    snapshotId: SNAPSHOT_ID,
    confirmedAt: CONFIRMED_AT,
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, ...(passed || !detail ? {} : { detail }) });
}

function staticModuleSource(): string {
  const root = join(process.cwd(), "src", "modules", "agent", "order", "confirmed-order");
  return [
    "confirmed-order-snapshot.types.ts",
    "confirmed-order-snapshot-validator.service.ts",
    "confirmed-order-snapshot.service.ts",
    "confirmed-order-receipt.types.ts",
    "confirmed-order-receipt.service.ts",
    "confirmed-order-preview.service.ts",
  ].map((file) => readFileSync(join(root, file), "utf8")).join("\n");
}

/** Permanent Phase 6.3G vertical regression. It never starts runtime transport. */
export async function evaluateConfirmedOrderSnapshot(): Promise<ConfirmedOrderEvaluationResult> {
  const cases: EvaluationCase[] = [];
  const validInput = input();
  const validCartJson = JSON.stringify(validInput.cart);
  const validPreviewJson = JSON.stringify(validInput.confirmedPreview);
  const valid = createConfirmedOrderSnapshot(validInput);
  const snapshot = valid.snapshot;

  add(cases, "valid confirmed preview creates a snapshot", valid.success && Boolean(snapshot));
  add(cases, "snapshot has the requested safe identifier", snapshot?.id === SNAPSHOT_ID);
  add(cases, "snapshot preserves the injected confirmation timestamp", snapshot?.confirmedAt === CONFIRMED_AT);
  add(cases, "non-confirmed preview state is rejected", !createConfirmedOrderSnapshot(input({ previewState: { version: 1, kind: "FINAL_ORDER_REVIEW" } })).success);
  add(cases, "incomplete cart is rejected", !createConfirmedOrderSnapshot(input({ cart: cart({ targetItemCount: 4 }) })).success);
  add(cases, "cart with a current draft is rejected", !createConfirmedOrderSnapshot(input({ cart: cart({ currentItemDraft: item({ id: "draft", status: "DRAFT" }) }) })).success);
  add(cases, "missing required delivery field is rejected", !createConfirmedOrderSnapshot(input({ cart: cart({ orderLevelFields: { ...cart().orderLevelFields, address: "" } }) })).success);
  add(cases, "multi-item snapshot contains every completed line", snapshot?.items.length === 2 && snapshot.completedUnits === 3);
  add(cases, "different variants remain separate", snapshot?.items[0]?.selectedOptions.find((option) => option.key === "color")?.value !== snapshot?.items[1]?.selectedOptions.find((option) => option.key === "color")?.value);
  const mergedCart = cart({ items: [item({ id: "merged-variant", quantity: 3 })] });
  const merged = createConfirmedOrderSnapshot(input({ cart: mergedCart, confirmedPreview: preview(mergedCart) }));
  add(cases, "merged identical variant keeps its quantity", merged.snapshot?.items.length === 1 && merged.snapshot.items[0]?.quantity === 3);
  add(cases, "custom item option is retained with its configured label", Boolean(snapshot?.items[0]?.selectedOptions.some((option) => option.key === "material" && option.label === "Matière" && option.value === "Cuir")));
  add(cases, "custom order field is retained when supplied by the confirmed preview", Boolean(snapshot?.orderFields.some((field) => field.key === "deliveryInstructions" && field.value === "قرب مسجد النور")));
  add(cases, "item quantity is preserved for every line", snapshot?.items.map((entry) => entry.quantity).join(",") === "1,2");
  add(cases, "unit prices come from server pricing", Boolean(snapshot?.items.every((entry) => entry.unitPrice === 199 && entry.unitPriceMinor === 19900)));
  add(cases, "line total uses exact minor-unit multiplication", Boolean(snapshot?.items.every((entry) => entry.lineTotalMinor === entry.unitPriceMinor * entry.quantity)));
  add(cases, "standard subtotal uses fresh B3/B2 pricing", snapshot?.standardSubtotal === 597 && snapshot.standardSubtotalMinor === 59700);
  add(cases, "selected offer is snapshotted from server evaluation", snapshot?.selectedOffer?.offerId === "bundle-three" && snapshot.selectedOffer.offerTotal === 499 && snapshot.selectedOffer.discountAmount === 98);
  add(cases, "final total matches fresh B3/B2 pricing", snapshot?.finalTotal === 499 && snapshot.finalTotalMinor === 49900);
  add(cases, "request-provided totals and currency are ignored", snapshot?.standardSubtotal !== validInput.confirmedPreview?.standardSubtotal && snapshot?.currency === "MAD");
  const ineligibleProduct = product({ offers: [{ ...product().offers![0], requiredItemCount: 4 }] });
  add(cases, "ineligible selected offer blocks snapshot creation", !createConfirmedOrderSnapshot(input({ productContext: ineligibleProduct })).success);
  const standardCart = cart({ mode: "STANDARD", selectedOfferId: undefined });
  const standard = createConfirmedOrderSnapshot(input({ cart: standardCart, confirmedPreview: preview(standardCart) }));
  add(cases, "standard mode snapshot works", standard.success && !standard.snapshot?.selectedOffer && standard.snapshot?.finalTotal === 597);
  add(cases, "recommended offer is never represented as selected", standard.snapshot?.recommendedOffer?.offerId === "bundle-three" && !standard.snapshot?.selectedOffer);
  add(cases, "snapshot and nested values are frozen", Boolean(snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.items) && Object.isFrozen(snapshot.items[0]) && Object.isFrozen(snapshot.items[0].selectedOptions)));
  const mutableCart = clone(validInput.cart!);
  const mutableProduct = clone(validInput.productContext);
  const detached = createConfirmedOrderSnapshot(input({ cart: mutableCart, productContext: mutableProduct, confirmedPreview: preview(mutableCart) }));
  const beforeMutation = JSON.stringify(detached.snapshot);
  mutableCart.items[0].quantity = 99;
  mutableCart.orderLevelFields.city = "مدينة مختلفة";
  mutableProduct.name = "Changed product";
  mutableProduct.price = 1;
  add(cases, "snapshot remains unchanged after cart and config mutation", JSON.stringify(detached.snapshot) === beforeMutation);
  add(cases, "unsafe snapshot identifier is rejected", !createConfirmedOrderSnapshot(input({ snapshotId: "../../unsafe" })).success);
  add(cases, "invalid confirmation time is rejected", !createConfirmedOrderSnapshot(input({ confirmedAt: "not-a-time" })).success);
  const factoryInput = input({
    snapshotId: undefined,
    confirmedAt: undefined,
    snapshotIdFactory: () => "factory-order-001",
    confirmedAtFactory: () => CONFIRMED_AT,
  });
  const factorySnapshot = createConfirmedOrderSnapshot(factoryInput);
  add(cases, "injected snapshot ID factory is honored", factorySnapshot.snapshot?.id === "factory-order-001");
  add(cases, "injected confirmation time factory is honored", factorySnapshot.snapshot?.confirmedAt === CONFIRMED_AT);
  const optionlessFields = fields.filter((field) => !["size", "color", "material"].includes(field.key));
  const optionlessProduct = product({ optionGroups: [], offers: [] });
  const optionlessCart = cart({ mode: "STANDARD", selectedOfferId: undefined, items: [item({ id: "optionless", quantity: 1, selectedOptions: {} })], targetItemCount: 1 });
  const optionless = createConfirmedOrderSnapshot(input({ productContext: optionlessProduct, requiredFields: optionlessFields, cart: optionlessCart, confirmedPreview: preview(optionlessCart, optionlessFields) }));
  add(cases, "option-less product appears correctly", Boolean(optionless.success && optionless.snapshot?.items[0]?.selectedOptions.length === 0));

  const receipt = snapshot ? buildConfirmedOrderReceiptModel(snapshot) : { success: false, warnings: [] as string[] };
  add(cases, "receipt model is created from a valid snapshot", receipt.success && Boolean(receipt.receiptModel));
  add(cases, "receipt model includes all item lines", receipt.receiptModel?.lines.length === 2);
  add(cases, "receipt model includes quantities and options", receipt.receiptModel?.lines[1]?.quantity === 2 && receipt.receiptModel.lines[0]?.options.some((option) => option.value === "أسود"));
  add(cases, "receipt model includes allowed delivery fields", Boolean(receipt.receiptModel?.deliveryFields.some((field) => field.label === "Adresse" && field.value.includes("Al Amal"))));
  add(cases, "receipt model includes selected offer and final total", receipt.receiptModel?.selectedOffer?.total === 499 && receipt.receiptModel.finalTotal === 499);
  const receiptText = JSON.stringify(receipt.receiptModel);
  add(cases, "receipt excludes internal scope and seller identifiers", !receiptText.includes(SELLER_ID) && !receiptText.includes(SCOPE_ID));
  add(cases, "receipt preserves Arabic French and English text", Boolean(receiptText.includes("أسود") && receiptText.includes("Élégance") && receiptText.includes("Premium")));
  const longProduct = snapshot ? { ...snapshot, product: { ...snapshot.product, name: "x".repeat(400) }, items: snapshot.items.map((entry) => ({ ...entry, productName: "x".repeat(400) })) } : undefined;
  const longReceipt = longProduct ? buildConfirmedOrderReceiptModel(longProduct) : { success: false, warnings: [] as string[] };
  add(cases, "long receipt text is bounded safely", longReceipt.receiptModel?.lines[0]?.productName.length === 200);
  const secondReceipt = snapshot ? buildConfirmedOrderReceiptModel(snapshot) : { success: false, warnings: [] as string[] };
  add(cases, "repeated receipt model generation is deterministic", JSON.stringify(receipt.receiptModel) === JSON.stringify(secondReceipt.receiptModel));
  add(cases, "snapshot creation does not mutate cart", JSON.stringify(validInput.cart) === validCartJson);
  add(cases, "snapshot creation does not mutate confirmed preview", JSON.stringify(validInput.confirmedPreview) === validPreviewJson);

  const document = receipt.receiptModel ? await generateConfirmedOrderReceiptPreviewPdf(receipt.receiptModel) : { success: false, warnings: [] as string[] };
  const documentAgain = receipt.receiptModel ? await generateConfirmedOrderReceiptPreviewPdf(receipt.receiptModel) : { success: false, warnings: [] as string[] };
  add(cases, "actual preview PDF has a valid signature", document.success && document.buffer?.subarray(0, 5).toString("ascii") === "%PDF-");
  add(cases, "preview PDF has a non-zero byte length", document.success && Boolean(document.byteLength && document.byteLength > 0));
  add(cases, "preview PDF declares application/pdf MIME type", document.mimeType === "application/pdf");
  add(cases, "preview PDF uses a safe deterministic filename", document.filename === `order-${SNAPSHOT_ID}.pdf` && !document.filename.includes(SCOPE_ID));
  add(cases, "preview PDF is generated for every receipt line", document.success && receipt.receiptModel?.lines.length === 2);
  add(cases, "repeated PDF generation is semantically idempotent", Boolean(documentAgain.success && documentAgain.filename === document.filename && documentAgain.mimeType === document.mimeType && documentAgain.byteLength && document.byteLength));

  const source = staticModuleSource();
  add(cases, "confirmed-order module has no persistence dependency", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm|store|repository)[^"']*/i.test(source));
  add(cases, "confirmed-order module has no queue or notification dependency", !/from\s+["'][^"']*(?:bull|queue|notification)[^"']*/i.test(source));
  add(cases, "confirmed-order module has no Cloud or WhatsApp dependency", !/from\s+["'][^"']*(?:whatsapp|cloud|meta)[^"']*/i.test(source));
  add(cases, "confirmed-order module has no global mutable state", !/^(?:let|var)\s+/m.test(source));
  add(cases, "confirmed-order module reuses the existing PDF engine", source.includes("renderOrderReceiptHtmlToPdfBuffer"));
  add(cases, "preview result never exposes raw PDF bytes", (() => {
    const safe = document.success ? {
      filename: document.filename,
      mimeType: document.mimeType,
      byteLength: document.byteLength,
      checksum: document.checksum,
    } : {};
    return !Object.prototype.hasOwnProperty.call(safe, "buffer");
  })());

  const phaseF = await evaluateDeliveryConfirmation();
  const b3 = evaluateCartCommercialIntegration();
  const b2 = evaluateCartPricing();
  add(cases, "Phase 6.3F evaluator remains green", phaseF.failed === 0);
  add(cases, "B3 commercial evaluator remains green", b3.summary.failed === 0);
  add(cases, "B2 pricing evaluator remains green", b2.summary.failed === 0);

  const passed = cases.filter((entry) => entry.passed).length;
  return {
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      passedAll: passed === cases.length,
    },
    cases,
  };
}
