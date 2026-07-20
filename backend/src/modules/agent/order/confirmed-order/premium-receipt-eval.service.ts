import fs from "node:fs/promises";
import path from "node:path";
import {
  buildLegacyPremiumReceiptModel,
  buildPremiumOrderReceiptHtml,
  buildSampleReceiptOrder,
  renderPremiumOrderReceiptPdfBuffer,
} from "../../../order-receipt/order-receipt.service";
import {
  PREMIUM_ORDER_RECEIPT_RENDERER_ID,
} from "../../../order-receipt/premium-order-receipt.types";
import type { PremiumOrderReceiptViewModel } from "../../../order-receipt/premium-order-receipt.types";
import { generateConfirmedOrderReceiptPreviewPdf } from "./confirmed-order-receipt.service";
import {
  buildPremiumReceiptPreviewModels,
  generatePremiumReceiptPreviews,
} from "./premium-receipt-preview.service";

type Check = Readonly<{ name: string; passed: boolean; detail?: string }>;

export type PremiumReceiptEvaluationReport = Readonly<{
  summary: Readonly<{
    total: number;
    passed: number;
    failed: number;
    strictAcceptance: boolean;
  }>;
  checks: readonly Check[];
  previews: Awaited<ReturnType<typeof generatePremiumReceiptPreviews>>;
}>;

function add(checks: Check[], name: string, passed: boolean, detail?: string): void {
  checks.push({ name, passed, ...(passed || !detail ? {} : { detail }) });
}

function countPdfPages(buffer: Buffer): number {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
}

function count(source: string, token: string): number {
  return source.split(token).length - 1;
}

export async function evaluatePremiumOrderReceipt(): Promise<PremiumReceiptEvaluationReport> {
  const checks: Check[] = [];
  const models = buildPremiumReceiptPreviewModels();
  const [oneHtml, variantsHtml, offerHtml] = await Promise.all([
    buildPremiumOrderReceiptHtml(models.oneItem),
    buildPremiumOrderReceiptHtml(models.twoVariants),
    buildPremiumOrderReceiptHtml(models.offerAndDelivery),
  ]);
  const previews = await generatePremiumReceiptPreviews();
  const onePdf = await fs.readFile(previews.oneItem.pdfPath);
  const variantsPdf = await fs.readFile(previews.twoVariants.pdfPath);
  const offerPdf = await fs.readFile(previews.offerAndDelivery.pdfPath);
  const confirmedDocument = await generateConfirmedOrderReceiptPreviewPdf(models.oneItem);
  const legacyModel = buildLegacyPremiumReceiptModel(buildSampleReceiptOrder());
  const legacyHtml = await buildPremiumOrderReceiptHtml(legacyModel);

  const backendRoot = process.cwd();
  const canonicalSource = await fs.readFile(
    path.join(backendRoot, "src/modules/order-receipt/order-receipt.service.ts"),
    "utf8",
  );
  const phaseSource = await fs.readFile(
    path.join(
      backendRoot,
      "src/modules/agent/order/confirmed-order/confirmed-order-receipt.service.ts",
    ),
    "utf8",
  );
  const runtimeSource = await fs.readFile(
    path.join(
      backendRoot,
      "src/modules/agent/order/runtime/order-runtime-router.service.ts",
    ),
    "utf8",
  );
  const cloudSource = await fs.readFile(
    path.join(backendRoot, "src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"),
    "utf8",
  );
  const evaluatorSource = await fs.readFile(
    path.join(
      backendRoot,
      "src/modules/agent/order/confirmed-order/premium-receipt-eval.service.ts",
    ),
    "utf8",
  );

  add(checks, "Phase 6.3 selects approved premium renderer", models.oneItem.rendererId === PREMIUM_ORDER_RECEIPT_RENDERER_ID);
  add(checks, "legacy receipt selects approved premium renderer", legacyModel.rendererId === PREMIUM_ORDER_RECEIPT_RENDERER_ID);
  add(checks, "legacy and Phase 6.3 share canonical render function", canonicalSource.includes("renderPremiumOrderReceiptPdfBuffer(buildLegacyPremiumReceiptModel(order))") && phaseSource.includes("renderPremiumOrderReceiptPdfBuffer(model)"));
  add(checks, "simplified confirmed-order HTML renderer is retired", !phaseSource.includes("<!doctype html") && !phaseSource.includes("function buildReceiptHtml"));
  add(checks, "only canonical receipt service owns customer-facing title markup", count(canonicalSource, '<h1 class="title">REÇU DE COMMANDE</h1>') === 1);
  add(checks, "premium header model exists", Boolean(models.oneItem.branding.storeName));
  add(checks, "seller logo name and tagline model exists", Boolean(models.oneItem.branding.logoUrl && models.oneItem.branding.storeName && models.oneItem.branding.slogan));
  add(checks, "contact block model exists", Boolean(models.oneItem.branding.phone && models.oneItem.branding.email && models.oneItem.branding.address));
  add(checks, "premium title is rendered", oneHtml.includes("REÇU DE COMMANDE") && oneHtml.includes("title-ornament"));
  add(checks, "order metadata cards are rendered", oneHtml.includes("Commande N°") && oneHtml.includes("Date") && oneHtml.includes("Statut"));
  add(checks, "confirmed status badge is rendered", oneHtml.includes("Commande confirmée") && oneHtml.includes("status-badge"));
  add(checks, "customer information section is rendered", oneHtml.includes("INFORMATIONS DU CLIENT") && oneHtml.includes("customer-list"));
  add(checks, "product image section is rendered", oneHtml.includes("PRODUIT COMMANDÉ") && oneHtml.includes("product-visual"));
  add(checks, "premium details table is rendered", oneHtml.includes("DÉTAILS DE LA COMMANDE") && oneHtml.includes("item-head"));
  add(checks, "recap section is rendered", oneHtml.includes("RÉCAPITULATIF") && oneHtml.includes("summary-total"));
  add(checks, "COD payment section is rendered", oneHtml.includes("MODE DE PAIEMENT") && oneHtml.includes("Paiement à la livraison"));
  add(checks, "premium footer is rendered", oneHtml.includes("footer-thanks") && oneHtml.includes("footer-heart"));
  add(checks, "information strip is preserved", oneHtml.includes("Conservez ce reçu jusqu’à la confirmation de la livraison."));
  add(checks, "public order code is rendered", oneHtml.includes("R3-ONE-ITEM"));
  add(checks, "one item renders once", count(oneHtml, "item-grid item-row") === 1);
  add(checks, "two variants render as separate lines", count(variantsHtml, "item-grid item-row") === 2);
  add(checks, "different variants remain distinct", variantsHtml.includes("38") && variantsHtml.includes("39") && variantsHtml.includes("وردي") && variantsHtml.includes("أسود"));
  add(checks, "dynamic custom option renders", offerHtml.includes("Finition") && offerHtml.includes("Mat"));
  const optionlessModel: PremiumOrderReceiptViewModel = {
    ...models.oneItem,
    referenceId: "R3-OPTIONLESS",
    lines: [{ ...models.oneItem.lines[0]!, options: [] }],
  };
  const optionlessHtml = await buildPremiumOrderReceiptHtml(optionlessModel);
  add(checks, "option-less products remain supported", optionlessHtml.includes("صندالة نسائية") && !optionlessHtml.includes('<div class="attribute-row">'));
  add(checks, "quantities render", variantsHtml.includes(">1</div>"));
  add(checks, "unit prices render", variantsHtml.includes("199,00 MAD"));
  add(checks, "line totals render", oneHtml.includes("398,00 MAD"));
  add(checks, "subtotal renders", offerHtml.includes("597,00 MAD"));
  add(checks, "offer label renders", offerHtml.includes("Offre 3 pièces"));
  add(checks, "discount renders at order level", offerHtml.includes("98,00 MAD") && offerHtml.includes("Réduction"));
  add(checks, "paid delivery renders", offerHtml.includes("35,00 MAD"));
  add(checks, "free delivery renders", oneHtml.includes("Gratuit"));
  add(checks, "final total renders", offerHtml.includes("534,00 MAD"));
  add(checks, "currency renders", oneHtml.includes("MAD"));
  add(checks, "Arabic and French text are preserved", oneHtml.includes("عمر العلوي") && oneHtml.includes("Téléphone") && oneHtml.includes("وردي"));
  add(checks, "Arabic has no replacement glyph", !oneHtml.includes("�"));
  add(checks, "long values use safe wrapping rules", canonicalSource.includes("overflow-wrap: anywhere") && canonicalSource.includes("unicode-bidi: plaintext"));
  add(checks, "configured product image is embedded", oneHtml.includes("data:image/png;base64,") && !oneHtml.includes(PRODUCT_IMAGE_LITERAL));
  add(checks, "configured logo is embedded", oneHtml.includes("data:image/svg+xml;base64,"));
  add(checks, "internal seller id is excluded", !oneHtml.includes("internal-premium-preview-seller"));
  add(checks, "internal conversation key is excluded", !oneHtml.includes("internal-premium-preview-conversation"));
  add(checks, "internal item and offer ids are excluded", !offerHtml.includes("internal-offer-one") && !offerHtml.includes("internal-bundle-three-id"));
  add(checks, "one-item PDF signature is valid", onePdf.subarray(0, 5).toString("ascii") === "%PDF-");
  add(checks, "two-variant PDF signature is valid", variantsPdf.subarray(0, 5).toString("ascii") === "%PDF-");
  add(checks, "offer PDF signature is valid", offerPdf.subarray(0, 5).toString("ascii") === "%PDF-");
  add(checks, "generated premium PDFs are non-empty", onePdf.length > 10_000 && variantsPdf.length > 10_000 && offerPdf.length > 10_000);
  add(checks, "premium filename convention is restored", confirmedDocument.filename === "recu-commande-R3-ONE-ITEM.pdf");
  add(checks, "premium document MIME is application/pdf", confirmedDocument.mimeType === "application/pdf");

  const longModel: PremiumOrderReceiptViewModel = {
    ...models.twoVariants,
    referenceId: "R3-MULTIPAGE",
    lines: Array.from({ length: 12 }, (_, index) => ({
      ...models.twoVariants.lines[index % 2]!,
      productName: `Produit premium ${index + 1} صندالة نسائية`,
    })),
  };
  const longPdf = await renderPremiumOrderReceiptPdfBuffer(longModel);
  add(checks, "multi-page output remains a valid PDF", longPdf.subarray(0, 5).toString("ascii") === "%PDF-");
  add(checks, "large multi-item receipt can continue across pages", countPdfPages(longPdf) >= 2, `pages=${countPdfPages(longPdf)}`);
  add(checks, "legacy premium structure is unchanged", legacyHtml.includes("top-grid") && legacyHtml.includes("summary-grid") && legacyHtml.includes("footer-thanks"));
  add(checks, "runtime snapshots branding and product image", runtimeSource.includes("productImageRef: productContext.images.find(Boolean)") && runtimeSource.includes("branding:"));
  add(checks, "runtime passes generated premium PDF artifact", runtimeSource.includes("receiptArtifact") && runtimeSource.includes("receipt.buffer"));
  add(checks, "Cloud reuses existing guarded document sender", cloudSource.includes("dispatchRuntimeReceiptArtifact") && cloudSource.includes("sendDocument({"));
  add(checks, "confirmed receipt module has no Meta transport", !/graph\.facebook\.com|sendMessage\(|sendDocument\(/i.test(phaseSource));
  add(checks, "confirmed receipt module has no second PDF engine", !phaseSource.includes("puppeteer") && !phaseSource.includes("page.pdf"));
  add(checks, "PDF bytes are not serializable receipt model data", !JSON.stringify(models.offerAndDelivery).includes("JVBERi0") && !Object.prototype.hasOwnProperty.call(models.offerAndDelivery, "buffer"));
  add(checks, "preview report exposes paths and lengths only", !Object.values(previews).some((entry) => Object.prototype.hasOwnProperty.call(entry, "buffer")));
  add(checks, "no live transport dependency exists in evaluator imports", !/from\s+["'][^"']*(?:whatsapp|cloud|meta)[^"']*["']/i.test(evaluatorSource.split("type Check")[0] || ""));

  const passed = checks.filter((check) => check.passed).length;
  return {
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      strictAcceptance: passed === checks.length && checks.length >= 40,
    },
    checks,
    previews,
  };
}

const PRODUCT_IMAGE_LITERAL = "src/modules/order-receipt/fixtures/demo-sandal-product-cropped.png";
