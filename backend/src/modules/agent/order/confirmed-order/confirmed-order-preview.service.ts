import {
  buildConfirmedOrderReceiptModel,
  generateConfirmedOrderReceiptPreviewPdf,
} from "./confirmed-order-receipt.service";
import { createConfirmedOrderSnapshot } from "./confirmed-order-snapshot.service";
import type {
  ConfirmedOrderReceiptPreparationResult,
  ConfirmedOrderReceiptPreviewInput,
  ConfirmedOrderReceiptPreviewResult,
  ConfirmedOrderSnapshotPreparationResult,
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

/** Builds and validates the immutable confirmation snapshot before any receipt work. */
export function prepareConfirmedOrderSnapshot(
  input: ConfirmedOrderReceiptPreviewInput,
): ConfirmedOrderSnapshotPreparationResult {
  if (!input.previewEnabled) return { success: false, warnings: [] };

  const snapshotResult = createConfirmedOrderSnapshot(input);
  if (!snapshotResult.success || !snapshotResult.snapshot) {
    return {
      success: false,
      ...(snapshotResult.failureCode ? { failureCode: snapshotResult.failureCode } : {}),
      warnings: [...snapshotResult.warnings],
    };
  }

  const receiptResult = buildConfirmedOrderReceiptModel(snapshotResult.snapshot);
  if (!receiptResult.success || !receiptResult.receiptModel) {
    return {
      success: false,
      failureCode: receiptResult.failureCode,
      snapshot: snapshotResult.snapshot,
      warnings: [...snapshotResult.warnings, ...receiptResult.warnings],
    };
  }

  return {
    success: true,
    snapshot: snapshotResult.snapshot,
    receiptModel: receiptResult.receiptModel,
    warnings: [...snapshotResult.warnings, ...receiptResult.warnings],
  };
}

/** Builds the real in-memory PDF from an already validated immutable snapshot. */
export async function prepareConfirmedOrderReceiptDocument(
  prepared: ConfirmedOrderSnapshotPreparationResult,
): Promise<ConfirmedOrderReceiptPreparationResult> {
  if (!prepared.success || !prepared.snapshot || !prepared.receiptModel) {
    return {
      success: false,
      ...(prepared.failureCode ? { failureCode: prepared.failureCode } : {}),
      warnings: [...prepared.warnings],
    };
  }

  const documentResult = await generateConfirmedOrderReceiptPreviewPdf(
    prepared.receiptModel,
  );
  if (!documentResult.success) {
    return {
      success: false,
      failureCode: documentResult.failureCode,
      snapshot: prepared.snapshot,
      receiptModel: prepared.receiptModel,
      warnings: [
        ...prepared.warnings,
        ...documentResult.warnings,
      ],
    };
  }

  if (
    !documentResult.filename ||
    !documentResult.mimeType ||
    documentResult.byteLength === undefined ||
    !documentResult.checksum ||
    !documentResult.buffer
  ) {
    return {
      success: false,
      failureCode: "PDF_GENERATION_FAILED",
      snapshot: prepared.snapshot,
      receiptModel: prepared.receiptModel,
      warnings: [...prepared.warnings, "incomplete_pdf_metadata"],
    };
  }

  return {
    success: true,
    snapshot: prepared.snapshot,
    receiptModel: prepared.receiptModel,
    receiptDocument: {
      filename: documentResult.filename,
      mimeType: documentResult.mimeType,
      byteLength: documentResult.byteLength,
      checksum: documentResult.checksum,
    },
    buffer: documentResult.buffer,
    warnings: [
      ...prepared.warnings,
      ...documentResult.warnings,
    ],
  };
}

/** Builds the immutable snapshot and real in-memory PDF without persistence or transport. */
export async function prepareConfirmedOrderReceipt(
  input: ConfirmedOrderReceiptPreviewInput,
): Promise<ConfirmedOrderReceiptPreparationResult> {
  return prepareConfirmedOrderReceiptDocument(prepareConfirmedOrderSnapshot(input));
}

export async function runConfirmedOrderReceiptPreview(
  input: ConfirmedOrderReceiptPreviewInput,
): Promise<ConfirmedOrderReceiptPreviewResult> {
  if (!input.previewEnabled) return blocked(input);
  const prepared = await prepareConfirmedOrderReceipt(input);
  return {
    handled: true,
    success: prepared.success,
    previewOnly: true,
    dryRun: true,
    ...(prepared.snapshot ? { snapshot: prepared.snapshot } : {}),
    ...(prepared.receiptModel ? { receiptModel: prepared.receiptModel } : {}),
    ...(prepared.receiptDocument ? { receiptDocument: prepared.receiptDocument } : {}),
    ...(prepared.failureCode ? { failureCode: prepared.failureCode } : {}),
    warnings: [...prepared.warnings],
  };
}
