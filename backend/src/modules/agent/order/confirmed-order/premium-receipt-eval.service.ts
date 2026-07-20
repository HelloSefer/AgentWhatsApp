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
import { groupPremiumReceiptItems } from "../../../order-receipt/premium-order-receipt-grouping.service";
import { generateConfirmedOrderReceiptPreviewPdf } from "./confirmed-order-receipt.service";
import {
  buildGroupedPremiumReceiptPreviewModels,
  buildPremiumReceiptPreviewModels,
  generateGroupedPremiumReceiptPreviews,
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
  groupedPreviews: Awaited<ReturnType<typeof generateGroupedPremiumReceiptPreviews>>;
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
  const groupedModels = buildGroupedPremiumReceiptPreviewModels();
  const [oneHtml, variantsHtml, offerHtml] = await Promise.all([
    buildPremiumOrderReceiptHtml(models.oneItem),
    buildPremiumOrderReceiptHtml(models.twoVariants),
    buildPremiumOrderReceiptHtml(models.offerAndDelivery),
  ]);
  const [twoColorsHtml, threeVariantsHtml, twoProductsHtml] = await Promise.all([
    buildPremiumOrderReceiptHtml(groupedModels.sameProductTwoColors),
    buildPremiumOrderReceiptHtml(groupedModels.sameProductThreeVariants),
    buildPremiumOrderReceiptHtml(groupedModels.twoProductsTwoVariantsEach),
  ]);
  const previews = await generatePremiumReceiptPreviews();
  const groupedPreviews = await generateGroupedPremiumReceiptPreviews();
  const onePdf = await fs.readFile(previews.oneItem.pdfPath);
  const variantsPdf = await fs.readFile(previews.twoVariants.pdfPath);
  const offerPdf = await fs.readFile(previews.offerAndDelivery.pdfPath);
  const groupedTwoColorsPdf = await fs.readFile(groupedPreviews.sameProductTwoColors.pdfPath);
  const groupedThreeVariantsPdf = await fs.readFile(groupedPreviews.sameProductThreeVariants.pdfPath);
  const groupedTwoProductsPdf = await fs.readFile(groupedPreviews.twoProductsTwoVariantsEach.pdfPath);
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
  add(checks, "one item renders once", count(oneHtml, "item-group-row item-group-compact") === 1 && count(oneHtml, "variant-cell variant-product-cell") === 1);
  add(checks, "two variants render as separate aligned lines", count(variantsHtml, "item-group-row item-group-compact") === 1 && count(variantsHtml, "variant-cell variant-product-cell") === 2);
  add(checks, "different variants remain distinct", variantsHtml.includes("38") && variantsHtml.includes("39") && variantsHtml.includes("وردي") && variantsHtml.includes("أسود"));
  add(checks, "dynamic custom option renders", offerHtml.includes("Finition") && offerHtml.includes("Mat"));
  const optionlessModel: PremiumOrderReceiptViewModel = {
    ...models.oneItem,
    referenceId: "R3-OPTIONLESS",
    lines: [{ ...models.oneItem.lines[0]!, options: [] }],
  };
  const optionlessHtml = await buildPremiumOrderReceiptHtml(optionlessModel);
  add(checks, "option-less products remain supported", optionlessHtml.includes("صندالة نسائية") && optionlessHtml.includes('<span class="variant-empty">Standard</span>'));
  add(checks, "quantities render", variantsHtml.includes('variant-numeric-cell column-quantity">1</div>'));
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
  add(checks, "grouped preview PDF signatures are valid", [groupedTwoColorsPdf, groupedThreeVariantsPdf, groupedTwoProductsPdf].every((pdf) => pdf.subarray(0, 5).toString("ascii") === "%PDF-"));
  add(checks, "generated premium PDFs are non-empty", onePdf.length > 10_000 && variantsPdf.length > 10_000 && offerPdf.length > 10_000);
  add(checks, "premium filename convention is restored", confirmedDocument.filename === "recu-commande-R3-ONE-ITEM.pdf");
  add(checks, "premium document MIME is application/pdf", confirmedDocument.mimeType === "application/pdf");

  const longModel: PremiumOrderReceiptViewModel = {
    ...models.twoVariants,
    referenceId: "R3-MULTIPAGE",
    lines: Array.from({ length: 12 }, (_, index) => ({
      ...models.twoVariants.lines[index % 2]!,
      productGroupKey: `multipage-product-${index}`,
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

  const twoColorGroups = groupPremiumReceiptItems(groupedModels.sameProductTwoColors.lines);
  const threeVariantGroups = groupPremiumReceiptItems(groupedModels.sameProductThreeVariants.lines);
  const twoProductGroups = groupPremiumReceiptItems(groupedModels.twoProductsTwoVariantsEach.lines);
  add(checks, "same-product variants use one top-level product group", twoColorGroups.length === 1 && count(twoColorsHtml, "item-group-row item-group-compact") === 1);
  add(checks, "same-product display name appears once", count(twoColorsHtml, '<div class="item-product-name dynamic-value" dir="auto">صندالة نسائية</div>') === 1);
  add(checks, "every grouped variant remains represented", twoColorGroups[0]?.variants.length === 2 && count(twoColorsHtml, "variant-cell variant-product-cell") === 2);
  add(checks, "grouped size and colors render correctly", twoColorsHtml.includes("37") && twoColorsHtml.includes("أسود") && twoColorsHtml.includes("وردي"));
  add(checks, "grouped quantity cells align by variant", count(twoColorsHtml, "variant-cell variant-numeric-cell column-quantity") === 2);
  add(checks, "grouped unit-price cells align by variant", count(twoColorsHtml, "variant-cell variant-numeric-cell column-unit-price") === 2);
  add(checks, "grouped total cells align by variant", count(twoColorsHtml, "variant-cell variant-numeric-cell column-total") === 2);
  add(checks, "three variants remain in source order", threeVariantGroups[0]?.variants.map((line) => line.options.find((option) => option.label === "Taille")?.value).join(",") === "36,37,40");
  add(checks, "different variant prices remain authoritative", threeVariantsHtml.includes("199,00 MAD") && threeVariantsHtml.includes("219,00 MAD"));
  add(checks, "different stable products remain separate groups", twoProductGroups.length === 2 && count(twoProductsHtml, "item-group-row item-group-compact") === 2);
  const sameNameDifferentProducts = groupedModels.twoProductsTwoVariantsEach.lines.map((line) => ({ ...line, productName: "Même produit affiché" }));
  add(checks, "same display name with different identities is not grouped", groupPremiumReceiptItems(sameNameDifferentProducts).length === 2);
  const immutableLinesJson = JSON.stringify(groupedModels.sameProductThreeVariants.lines);
  groupPremiumReceiptItems(groupedModels.sameProductThreeVariants.lines);
  add(checks, "presentation grouping does not mutate snapshot-derived lines", JSON.stringify(groupedModels.sameProductThreeVariants.lines) === immutableLinesJson);
  add(checks, "grouping preserves authoritative subtotal", groupedModels.sameProductThreeVariants.lines.reduce((total, line) => total + line.lineTotal, 0) === groupedModels.sameProductThreeVariants.standardSubtotal);
  const optionlessGroupedModel: PremiumOrderReceiptViewModel = {
    ...models.oneItem,
    referenceId: "R4-OPTIONLESS-GROUP",
    lines: [
      { ...models.oneItem.lines[0]!, productGroupKey: "optionless-group", quantity: 1, options: [] },
      { ...models.oneItem.lines[0]!, productGroupKey: "optionless-group", quantity: 2, options: [] },
    ],
  };
  const optionlessGroupedHtml = await buildPremiumOrderReceiptHtml(optionlessGroupedModel);
  add(checks, "multiple option-less lines render safe compact labels", count(optionlessGroupedHtml, "item-group-row item-group-compact") === 1 && optionlessGroupedHtml.includes("Article 1") && optionlessGroupedHtml.includes("Article 2"));
  add(checks, "dynamic grouped custom options render", threeVariantsHtml.includes("Finition") && threeVariantsHtml.includes("Premium mate"));
  const longOptionModel: PremiumOrderReceiptViewModel = {
    ...groupedModels.sameProductTwoColors,
    referenceId: "R4-LONG-OPTION",
    lines: groupedModels.sameProductTwoColors.lines.map((line, index) => index === 0 ? {
      ...line,
      options: [{ label: "Personnalisation", value: "قيمة طويلة قابلة للالتفاف داخل السطر بدون تداخل مع أعمدة الأسعار أو الكمية" }],
    } : line),
  };
  const longOptionHtml = await buildPremiumOrderReceiptHtml(longOptionModel);
  add(checks, "long grouped values retain safe wrapping", longOptionHtml.includes("قيمة طويلة") && canonicalSource.includes(".variant-option-value") && canonicalSource.includes("overflow-wrap: anywhere"));
  add(checks, "grouped Arabic and French remain readable", twoColorsHtml.includes("Couleur") && twoColorsHtml.includes("أسود") && !twoColorsHtml.includes("�"));
  add(checks, "grouping identities and internal product IDs are never rendered", !twoProductsHtml.includes("prod_demo_") && !twoProductsHtml.includes(groupedModels.twoProductsTwoVariantsEach.lines[0]?.productGroupKey || "__missing__"));
  add(checks, "premium layout markers survive grouping", twoColorsHtml.includes("REÇU DE COMMANDE") && twoColorsHtml.includes("DÉTAILS DE LA COMMANDE") && twoColorsHtml.includes("summary-grid") && twoColorsHtml.includes("footer-thanks"));
  add(checks, "grouped PDFs are non-empty", [groupedTwoColorsPdf, groupedThreeVariantsPdf, groupedTwoProductsPdf].every((pdf) => pdf.length > 10_000));
  add(checks, "grouped previews expose no PDF Buffer", !Object.values(groupedPreviews).some((entry) => Object.prototype.hasOwnProperty.call(entry, "buffer")));

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
    groupedPreviews,
  };
}

const PRODUCT_IMAGE_LITERAL = "src/modules/order-receipt/fixtures/demo-sandal-product-cropped.png";
