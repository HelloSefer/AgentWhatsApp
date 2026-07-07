import crypto from "crypto";
import { env } from "../../config/env";
import type { OrderEntities } from "../agent/agent-brain.types";

const TOKEN_TTL_MS = 30 * 60 * 1000;

type OrderFormTokenPayload = {
  waId: string;
  phoneNumberId: string;
  createdAt: number;
};

export type OrderFormTokenResult =
  | { ok: true; payload: OrderFormTokenPayload }
  | { ok: false; errorMessage: string };

export type OrderFormSubmitInput = {
  fullName?: unknown;
  phone?: unknown;
  city?: unknown;
  address?: unknown;
  size?: unknown;
  color?: unknown;
  quantity?: unknown;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getTokenSecret(): string {
  return env.orderFormTokenSecret || env.whatsappCloudVerifyToken;
}

function signPayload(encodedPayload: string): string {
  return crypto
    .createHmac("sha256", getTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createOrderFormToken(input: {
  waId: string;
  phoneNumberId: string;
}): string {
  const payload: OrderFormTokenPayload = {
    waId: input.waId,
    phoneNumberId: input.phoneNumberId,
    createdAt: Date.now(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyOrderFormToken(token: string): OrderFormTokenResult {
  if (!token.trim()) {
    return { ok: false, errorMessage: "رابط الاستمارة ناقص أو غير صالح." };
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return { ok: false, errorMessage: "رابط الاستمارة غير صالح." };
  }

  const expectedSignature = signPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return { ok: false, errorMessage: "رابط الاستمارة غير صالح." };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as OrderFormTokenPayload;

    if (!payload.waId || !payload.phoneNumberId || !payload.createdAt) {
      return { ok: false, errorMessage: "رابط الاستمارة غير صالح." };
    }

    if (Date.now() - payload.createdAt > TOKEN_TTL_MS) {
      return {
        ok: false,
        errorMessage: "رابط الاستمارة سالا. عافاك طلب رابط جديد فواتساب.",
      };
    }

    return { ok: true, payload };
  } catch (_error) {
    return { ok: false, errorMessage: "رابط الاستمارة غير صالح." };
  }
}

export function buildOrderFormUrl(input: {
  publicBaseUrl: string;
  waId: string;
  phoneNumberId: string;
}): string {
  const token = createOrderFormToken({
    waId: input.waId,
    phoneNumberId: input.phoneNumberId,
  });
  const url = new URL("/order-form", input.publicBaseUrl);

  url.searchParams.set("wa", input.waId);
  url.searchParams.set("phoneNumberId", input.phoneNumberId);
  url.searchParams.set("token", token);

  return url.toString();
}

export function resolveOrderFormBaseUrl(requestBaseUrl?: string): {
  baseUrl: string;
  baseUrlSource: "env" | "request";
  publicBaseUrlConfigured: boolean;
  usedFallbackBaseUrl: boolean;
} {
  if (env.publicBaseUrl) {
    return {
      baseUrl: env.publicBaseUrl,
      baseUrlSource: "env",
      publicBaseUrlConfigured: true,
      usedFallbackBaseUrl: false,
    };
  }

  return {
    baseUrl: (requestBaseUrl || "").trim().replace(/\/+$/, ""),
    baseUrlSource: "request",
    publicBaseUrlConfigured: false,
    usedFallbackBaseUrl: true,
  };
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeOrderFormSubmission(
  input: OrderFormSubmitInput,
): OrderEntities {
  const quantity = Number(input.quantity);

  return {
    fullName: getString(input.fullName),
    phone: getString(input.phone),
    city: getString(input.city),
    address: getString(input.address),
    size: getString(input.size),
    color: getString(input.color),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
  };
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

export function getOrderFormMissingFields(order: OrderEntities): string[] {
  const requiredFields: Array<keyof OrderEntities> = [
    "fullName",
    "phone",
    "city",
    "address",
    "size",
    "color",
    "quantity",
  ];

  return requiredFields.filter((field) => !hasValue(order[field]));
}

export function buildOrderFormConfirmationSummary(order: OrderEntities): string {
  return [
    "توصلت بمعلومات الطلب:",
    "",
    `الاسم: ${order.fullName || ""}`,
    `الهاتف: ${order.phone || ""}`,
    `المدينة: ${order.city || ""}`,
    `العنوان: ${order.address || ""}`,
    `المقاس: ${order.size || ""}`,
    `اللون: ${order.color || ""}`,
    `الكمية: ${order.quantity || ""}`,
    "",
    "واش نأكد لك الطلب؟",
  ].join("\n");
}

function renderErrorPage(message: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>معلومات الطلب</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f7f9; color: #1f2933; }
      main { max-width: 520px; margin: 0 auto; padding: 32px 18px; }
      .card { background: white; border-radius: 12px; padding: 22px; box-shadow: 0 8px 28px rgba(15, 23, 42, .08); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { line-height: 1.7; }
    </style>
  </head>
  <body>
    <main><section class="card"><h1>معلومات الطلب</h1><p>${message}</p></section></main>
  </body>
</html>`;
}

export function renderOrderFormPage(input: {
  token: string;
  tokenResult: OrderFormTokenResult;
}): string {
  if (!input.tokenResult.ok) {
    return renderErrorPage(input.tokenResult.errorMessage);
  }

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>معلومات الطلب</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #f4f6f8;
        color: #111827;
      }
      main {
        max-width: 540px;
        margin: 0 auto;
        padding: 24px 16px 40px;
      }
      .card {
        background: #fff;
        border-radius: 14px;
        padding: 22px;
        box-shadow: 0 10px 30px rgba(17, 24, 39, .08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 26px;
      }
      .subtitle {
        margin: 0 0 22px;
        color: #4b5563;
        line-height: 1.6;
      }
      label {
        display: block;
        margin: 14px 0 6px;
        font-weight: 700;
      }
      input, select {
        width: 100%;
        min-height: 46px;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 16px;
        background: #fff;
      }
      button, .whatsapp-link {
        width: 100%;
        min-height: 48px;
        border: 0;
        border-radius: 10px;
        background: #16a34a;
        color: white;
        font-size: 17px;
        font-weight: 700;
        margin-top: 20px;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .success {
        display: none;
        text-align: center;
      }
      .success p {
        line-height: 1.8;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card" id="form-card">
        <h1>معلومات الطلب</h1>
        <p class="subtitle">عمّر المعلومات وغادي نأكدو لك الطلب فواتساب</p>
        <form id="order-form">
          <input type="hidden" name="token" value="${input.token}" />
          <label for="fullName">الاسم الكامل</label>
          <input id="fullName" name="fullName" required autocomplete="name" />
          <label for="phone">رقم الهاتف</label>
          <input id="phone" name="phone" required inputmode="tel" autocomplete="tel" />
          <label for="city">المدينة</label>
          <input id="city" name="city" required autocomplete="address-level2" />
          <label for="address">العنوان</label>
          <input id="address" name="address" required autocomplete="street-address" />
          <label for="size">المقاس</label>
          <select id="size" name="size" required>
            <option value="">اختاري المقاس</option>
            <option value="36">36</option>
            <option value="37">37</option>
            <option value="38">38</option>
            <option value="39">39</option>
            <option value="40">40</option>
          </select>
          <label for="color">اللون</label>
          <select id="color" name="color" required>
            <option value="">اختاري اللون</option>
            <option value="وردي">وردي</option>
            <option value="أسود">أسود</option>
          </select>
          <label for="quantity">الكمية</label>
          <input id="quantity" name="quantity" type="number" value="1" min="1" max="10" required />
          <button type="submit">إرسال الطلب</button>
        </form>
      </section>
      <section class="card success" id="success-card">
        <h1>تم الإرسال</h1>
        <p>توصلنا بمعلوماتك ✅ رجع للواتساب باش تأكد الطلب</p>
        <a class="whatsapp-link" href="https://wa.me/">رجوع للواتساب</a>
      </section>
    </main>
    <script>
      const form = document.getElementById("order-form");
      const formCard = document.getElementById("form-card");
      const successCard = document.getElementById("success-card");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        const response = await fetch("/api/order-form/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          alert(result.message || "وقع مشكل. عاودي جربي من فضلك.");
          return;
        }
        formCard.style.display = "none";
        successCard.style.display = "block";
      });
    </script>
  </body>
</html>`;
}
