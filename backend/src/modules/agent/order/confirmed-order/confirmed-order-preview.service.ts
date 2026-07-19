import {
  buildConfirmedOrderReceiptModel,
  generateConfirmedOrderReceiptPreviewPdf,
} from "./confirmed-order-receipt.service";
import { createConfirmedOrderSnapshot } from "./confirmed-order-snapshot.service";
import type {
  ConfirmedOrderReceiptPreviewInput,
  ConfirmedOrderReceiptPreviewResult,
} from "./confirmed-order-receipt.types";

function blocked(
  input: ConfirmedOrderReceiptPreviewInput,
): ConfirmedOrderReceiptPreviewResult {
  return {
    handled: false,
    success: false,
    previewOnly: true,
    dryRun: true,
    warnings: [],
  };
}

/**
 * Controller-only preview adapter. It intentionally builds a detached snapshot
 * and an in-memory document; it has no persistence, session, or transport side effects.
 */
export async function runConfirmedOrderReceiptPreview(
  input: ConfirmedOrderReceiptPreviewInput,
): Promise<ConfirmedOrderReceiptPreviewResult> {
  if (!input.previewEnabled) return blocked(input);

  const snapshotResult = createConfirmedOrderSnapshot(input);
  if (!snapshotResult.success || !snapshotResult.snapshot) {
    return {
      handled: true,
      success: false,
      previewOnly: true,
      dryRun: true,
      ...(snapshotResult.failureCode ? { failureCode: snapshotResult.failureCode } : {}),
      warnings: [...snapshotResult.warnings],
    };
  }

  const receiptResult = buildConfirmedOrderReceiptModel(snapshotResult.snapshot);
  if (!receiptResult.success || !receiptResult.receiptModel) {
    return {
      handled: true,
      success: false,
      previewOnly: true,
      dryRun: true,
      failureCode: receiptResult.failureCode,
      snapshot: snapshotResult.snapshot,
      warnings: [...snapshotResult.warnings, ...receiptResult.warnings],
    };
  }

  const documentResult = await generateConfirmedOrderReceiptPreviewPdf(
    receiptResult.receiptModel,
  );
  if (!documentResult.success) {
    return {
      handled: true,
      success: false,
      previewOnly: true,
      dryRun: true,
      failureCode: documentResult.failureCode,
      snapshot: snapshotResult.snapshot,
      receiptModel: receiptResult.receiptModel,
      warnings: [
        ...snapshotResult.warnings,
        ...receiptResult.warnings,
        ...documentResult.warnings,
      ],
    };
  }

  if (
    !documentResult.filename ||
    !documentResult.mimeType ||
    documentResult.byteLength === undefined ||
    !documentResult.checksum
  ) {
    return {
      handled: true,
      success: false,
      previewOnly: true,
      dryRun: true,
      failureCode: "PDF_GENERATION_FAILED",
      snapshot: snapshotResult.snapshot,
      receiptModel: receiptResult.receiptModel,
      warnings: [...snapshotResult.warnings, ...receiptResult.warnings, "incomplete_pdf_metadata"],
    };
  }

  return {
    handled: true,
    success: true,
    previewOnly: true,
    dryRun: true,
    snapshot: snapshotResult.snapshot,
    receiptModel: receiptResult.receiptModel,
    receiptDocument: {
      filename: documentResult.filename,
      mimeType: documentResult.mimeType,
      byteLength: documentResult.byteLength,
      checksum: documentResult.checksum,
    },
    warnings: [
      ...snapshotResult.warnings,
      ...receiptResult.warnings,
      ...documentResult.warnings,
    ],
  };
}
