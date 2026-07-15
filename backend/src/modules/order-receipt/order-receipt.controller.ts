import fs from "node:fs/promises";
import type { Request, Response } from "express";
import {
  getConfirmedOrderById,
  updateConfirmedOrderReceipt,
} from "../agent/order/confirmed-order-store.service";
import {
  recordReceiptFailedInvalidOrderData,
} from "../agent/order/order-field-validator.service";
import {
  buildSampleReceiptOrder,
  generateOrderReceiptPdf,
  getOrderReceiptPdfPath,
  getOrderReceiptRecord,
} from "./order-receipt.service";
import {
  RECEIPT_DATA_INVALID,
  validateConfirmedOrderReceiptSnapshot,
} from "./order-receipt-validation.service";
import { sendOrderReceiptDocumentForOrder } from "../whatsapp/cloud/whatsapp-cloud.service";

async function fileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);

    return stat.size;
  } catch (_error) {
    return 0;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

export async function testGenerateOrderReceipt(req: Request, res: Response) {
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
  const useSample = req.body?.sample === true;
  const order = orderId ? getConfirmedOrderById(orderId) : undefined;

  if (!order && !useSample) {
    return res.status(404).json({
      ok: false,
      message: "Order not found. Provide orderId or sample=true.",
    });
  }

  if (order) {
    const validation = validateConfirmedOrderReceiptSnapshot(order);

    if (!validation.valid) {
      recordReceiptFailedInvalidOrderData({
        orderId: order.id,
        invalidFields: validation.invalidFields,
      });
      updateConfirmedOrderReceipt(order.id, {
        receiptSendStatus: "FAILED",
        receiptError: "Confirmed order receipt snapshot is structurally invalid",
        receiptErrorCode: RECEIPT_DATA_INVALID,
        receiptInvalidFields: validation.invalidFields,
      });

      return res.status(400).json({
        ok: false,
        message: "Confirmed order receipt snapshot is structurally invalid.",
        errorCode: RECEIPT_DATA_INVALID,
        invalidFields: validation.invalidFields,
      });
    }
  }

  const result = await generateOrderReceiptPdf(order || buildSampleReceiptOrder());

  if (result.ok && order && result.pdfPath) {
    updateConfirmedOrderReceipt(order.id, {
      receiptPdfPath: result.pdfPath,
      receiptSendStatus: order.receiptSendStatus || "SKIPPED",
    });
  }

  return res.status(result.ok ? 200 : 500).json(result);
}

export async function testSendOrderReceipt(req: Request, res: Response) {
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";

  if (!to || !orderId) {
    return res.status(400).json({
      ok: false,
      message: "to and orderId are required",
    });
  }

  const order = getConfirmedOrderById(orderId);

  if (!order) {
    return res.status(404).json({
      ok: false,
      message: "Order not found",
    });
  }

  const result = await sendOrderReceiptDocumentForOrder({
    to,
    order,
    allowDuplicate: true,
  });

  return res.status(result.success ? 200 : 502).json(result);
}

export async function downloadOrderReceipt(req: Request, res: Response) {
  const orderId = typeof req.params.orderId === "string" ? req.params.orderId.trim() : "";
  const order = getConfirmedOrderById(orderId);
  const receiptRecord = getOrderReceiptRecord(orderId);
  const pdfPath =
    receiptRecord?.pdfPath ||
    getOrderReceiptPdfPath(orderId, order?.publicOrderCode);

  if (!(await exists(pdfPath))) {
    return res.status(404).json({
      ok: false,
      message:
        order?.receiptLocalFileDeleted || receiptRecord?.localFileDeleted
          ? "Receipt PDF file is no longer available locally"
          : "Receipt PDF not found",
    });
  }

  res.type("application/pdf");
  res.setHeader("Content-Length", String(await fileSize(pdfPath)));

  return res.sendFile(pdfPath);
}
