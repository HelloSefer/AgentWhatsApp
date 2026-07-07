import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "../../config/env";
import type {
  OrderReceiptOrder,
  OrderReceiptRecord,
  ReceiptSendStatus,
} from "./order-receipt.types";

type GenerateReceiptResult = {
  ok: boolean;
  pdfPath?: string;
  exists: boolean;
  sizeBytes: number;
  errorMessage?: string;
};

type OrderReceiptDiagnostics = {
  totalOrderReceiptPdfGenerated: number;
  totalOrderReceiptPdfFailed: number;
  totalOrderReceiptDocumentsSent: number;
  totalOrderReceiptDocumentsFailed: number;
  totalOrderReceiptDuplicateSkipped: number;
  lastOrderReceiptSentAt?: string;
};

const receiptRecords = new Map<string, OrderReceiptRecord>();
const diagnostics: OrderReceiptDiagnostics = {
  totalOrderReceiptPdfGenerated: 0,
  totalOrderReceiptPdfFailed: 0,
  totalOrderReceiptDocumentsSent: 0,
  totalOrderReceiptDocumentsFailed: 0,
  totalOrderReceiptDuplicateSkipped: 0,
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

export function getOrderReceiptPdfPath(orderId: string): string {
  return path.join(getOrderReceiptOutputDir(), `${orderId}.pdf`);
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
}) {
  diagnostics.totalOrderReceiptDocumentsSent += 1;
  diagnostics.lastOrderReceiptSentAt = new Date().toISOString();
  receiptRecords.set(input.orderId, {
    orderId: input.orderId,
    pdfPath: input.pdfPath,
    mediaId: input.mediaId,
    sentAt: diagnostics.lastOrderReceiptSentAt,
    sendStatus: "SENT",
  });
}

export function recordOrderReceiptDocumentFailed(input: {
  orderId: string;
  pdfPath?: string;
  errorMessage: string;
}) {
  diagnostics.totalOrderReceiptDocumentsFailed += 1;
  receiptRecords.set(input.orderId, {
    orderId: input.orderId,
    pdfPath: input.pdfPath,
    sendStatus: "FAILED",
    lastError: input.errorMessage,
  });
}

export function recordOrderReceiptSkipped(input: {
  orderId: string;
  pdfPath?: string;
  status?: ReceiptSendStatus;
}) {
  diagnostics.totalOrderReceiptDuplicateSkipped += 1;
  receiptRecords.set(input.orderId, {
    orderId: input.orderId,
    pdfPath: input.pdfPath,
    sendStatus: input.status || "SKIPPED",
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

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (_error) {
    return 0;
  }
}

async function getLogoHtml(): Promise<string> {
  const logoPath = env.orderReceiptLogoPath.trim();

  if (!logoPath) {
    return "";
  }

  const resolvedLogoPath = resolveFromBackendRoot(logoPath);

  if (!(await fileExists(resolvedLogoPath))) {
    return "";
  }

  return `<img class="logo" src="${pathToFileURL(resolvedLogoPath).toString()}" alt="logo" />`;
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("ar-MA", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (_error) {
    return value;
  }
}

async function buildReceiptHtml(order: OrderReceiptOrder): Promise<string> {
  const logoHtml = await getLogoHtml();
  const supportPhone = env.orderReceiptSupportPhone.trim();

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 34px;
        background: #f4f6f8;
        color: #17202a;
        font-family: Tahoma, Arial, sans-serif;
        direction: rtl;
      }
      .receipt {
        max-width: 720px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e4e7ec;
        border-radius: 18px;
        padding: 30px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, .08);
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        border-bottom: 2px solid #111827;
        padding-bottom: 18px;
        margin-bottom: 24px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .logo {
        width: 58px;
        height: 58px;
        object-fit: contain;
        border-radius: 12px;
      }
      .store-name {
        font-size: 25px;
        font-weight: 800;
      }
      .title {
        font-size: 30px;
        font-weight: 900;
      }
      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 24px;
      }
      .pill {
        background: #f7fafc;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px 14px;
      }
      .label {
        display: block;
        color: #667085;
        font-size: 12px;
        margin-bottom: 5px;
      }
      .value {
        font-size: 15px;
        font-weight: 700;
      }
      .section {
        margin-top: 18px;
      }
      .section h2 {
        font-size: 18px;
        margin: 0 0 12px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        overflow: hidden;
        border-radius: 12px;
      }
      th, td {
        border: 1px solid #e5e7eb;
        padding: 12px;
        text-align: right;
        vertical-align: top;
      }
      th {
        width: 34%;
        background: #f8fafc;
        color: #344054;
      }
      .status {
        color: #047857;
        font-weight: 800;
      }
      .footer {
        margin-top: 26px;
        padding-top: 18px;
        border-top: 1px solid #e5e7eb;
        color: #344054;
        line-height: 1.7;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main class="receipt">
      <header class="header">
        <div class="brand">
          ${logoHtml}
          <div class="store-name">${escapeHtml(env.orderReceiptStoreName)}</div>
        </div>
        <div class="title">وصل الطلب</div>
      </header>

      <section class="meta">
        <div class="pill">
          <span class="label">رقم الطلب</span>
          <span class="value">${escapeHtml(order.id)}</span>
        </div>
        <div class="pill">
          <span class="label">تاريخ التأكيد</span>
          <span class="value">${escapeHtml(formatDate(order.createdAt))}</span>
        </div>
      </section>

      <section class="section">
        <h2>معلومات الزبون</h2>
        <table>
          <tr><th>الاسم</th><td>${escapeHtml(order.fullName)}</td></tr>
          <tr><th>الهاتف</th><td>${escapeHtml(order.phone)}</td></tr>
          <tr><th>المدينة</th><td>${escapeHtml(order.city)}</td></tr>
          <tr><th>العنوان</th><td>${escapeHtml(order.address)}</td></tr>
        </table>
      </section>

      <section class="section">
        <h2>معلومات الطلب</h2>
        <table>
          <tr><th>المنتج</th><td>${escapeHtml(order.productName)}</td></tr>
          <tr><th>المقاس</th><td>${escapeHtml(order.size)}</td></tr>
          <tr><th>اللون</th><td>${escapeHtml(order.color)}</td></tr>
          <tr><th>الكمية</th><td>${escapeHtml(order.quantity)}</td></tr>
          <tr><th>الدفع</th><td>عند الاستلام</td></tr>
          <tr><th>الحالة</th><td class="status">مؤكد</td></tr>
        </table>
      </section>

      <footer class="footer">
        <strong>شكراً على طلبك ✅</strong><br />
        سيتم التواصل معك لتأكيد التوصيل.
        ${supportPhone ? `<br />للمساعدة: ${escapeHtml(supportPhone)}` : ""}
      </footer>
    </main>
  </body>
</html>`;
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

  const pdfPath = getOrderReceiptPdfPath(order.id);

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

    const html = await buildReceiptHtml(order);
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: "load",
      });
      await page.pdf({
        path: pdfPath,
        format: "A4",
        printBackground: true,
        margin: {
          top: "16mm",
          right: "12mm",
          bottom: "16mm",
          left: "12mm",
        },
      });
    } finally {
      await browser.close();
    }

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
  return {
    id: `sample-${Date.now()}`,
    customerId: "sample-customer",
    productName: "صندالة نسائية",
    fullName: "سارة العلوي",
    phone: "0612345678",
    city: "مراكش",
    address: "حي السلام",
    size: "38",
    color: "أسود",
    quantity: 1,
    status: "CONFIRMED",
    createdAt: new Date().toISOString(),
  };
}
