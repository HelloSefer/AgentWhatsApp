import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../../config/env";

type TransportCheck = Readonly<{
  name: string;
  passed: boolean;
  detail?: string;
}>;

export type OfficialWhatsappTransportEvaluationReport = Readonly<{
  summary: Readonly<{
    total: number;
    passed: number;
    failed: number;
    strictAcceptance: boolean;
  }>;
  activeProvider: string;
  inactiveLegacyLocations: readonly string[];
  checks: readonly TransportCheck[];
}>;

function add(
  checks: TransportCheck[],
  name: string,
  passed: boolean,
  detail?: string,
): void {
  checks.push({ name, passed, ...(passed || !detail ? {} : { detail }) });
}

async function source(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

/** Focused source-boundary audit. It never initializes or calls a provider. */
export async function evaluateOfficialWhatsappTransportArchitecture(): Promise<OfficialWhatsappTransportEvaluationReport> {
  const checks: TransportCheck[] = [];
  const [
    serverSource,
    envSource,
    envExampleSource,
    cloudSource,
    cloudDispatchSource,
    runtimeSource,
    receiptAdapterSource,
    receiptRendererSource,
    receiptPreviewSource,
    legacyBaileysSource,
    packageSource,
  ] = await Promise.all([
    source("src/server.ts"),
    source("src/config/env.ts"),
    source(".env.example"),
    source("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"),
    source("src/modules/whatsapp/cloud/cloud-reply-dispatch.service.ts"),
    source("src/modules/agent/order/runtime/order-runtime-router.service.ts"),
    source("src/modules/agent/order/confirmed-order/confirmed-order-receipt.service.ts"),
    source("src/modules/order-receipt/order-receipt.service.ts"),
    source("src/modules/agent/order/confirmed-order/premium-receipt-preview.service.ts"),
    source("src/modules/whatsapp/whatsapp.service.ts"),
    source("package.json"),
  ]);

  const activeMessagingSources = [
    serverSource,
    cloudSource,
    cloudDispatchSource,
    runtimeSource,
    receiptAdapterSource,
  ].join("\n");

  add(checks, "configured active provider is Cloud API", env.whatsappProvider === "cloud_api", env.whatsappProvider);
  add(checks, "provider default is Cloud API", envSource.includes('process.env.WHATSAPP_PROVIDER || "cloud_api"'));
  add(checks, "example configuration selects Cloud API", /^WHATSAPP_PROVIDER=cloud_api$/m.test(envExampleSource));
  add(checks, "backend startup has no Baileys service import", !/whatsapp\.service|startWhatsApp|baileys/i.test(serverSource));
  add(checks, "unsupported providers remain disabled at startup", serverSource.includes("Cloud API is the only active runtime transport") && !serverSource.includes("startWhatsApp("));
  add(checks, "active Cloud path has no unofficial package import", !/@whiskeysockets\/baileys|whatsapp-web\.js|venom|wppconnect/i.test(activeMessagingSources));
  add(checks, "guarded order runtime has no provider dependency", !/modules\/whatsapp|whatsapp\.service|baileys|sendMessage\(/i.test(runtimeSource));
  add(checks, "confirmed receipt adapter has no transport dependency", !/modules\/whatsapp|graph\.facebook\.com|sendDocument\(|sendMessage\(/i.test(receiptAdapterSource));
  add(checks, "Cloud transport uses official Graph API", cloudSource.includes('const GRAPH_API_BASE_URL = "https://graph.facebook.com"') && cloudSource.includes("postCloudMessage("));
  add(checks, "receipt documents use Cloud upload and document send", cloudSource.includes("uploadMedia({") && cloudSource.includes("type: \"document\"") && cloudSource.includes("const transport = input.transport || sendDocument"));
  add(checks, "Cloud failures never fall back to Baileys", !/baileys|whatsapp\.service|startWhatsApp/i.test(`${cloudSource}\n${cloudDispatchSource}`));
  add(checks, "QR session startup is absent from active sources", !/useMultiFileAuthState|qrcode|qr-session|startWhatsApp/i.test(activeMessagingSources));
  add(checks, "Puppeteer is absent from active messaging transport", !/puppeteer|playwright|selenium/i.test(activeMessagingSources));
  add(checks, "browser tooling is restricted to receipt rendering and previews", receiptRendererSource.includes('import("puppeteer")') && receiptPreviewSource.includes('import("puppeteer")'));
  add(checks, "no browser automation targets WhatsApp Web", !/web\.whatsapp\.com|whatsapp web/i.test(`${activeMessagingSources}\n${receiptRendererSource}\n${receiptPreviewSource}`));
  add(checks, "legacy Baileys code remains identifiable but inactive", legacyBaileysSource.includes('@whiskeysockets/baileys') && packageSource.includes('@whiskeysockets/baileys') && !serverSource.includes("whatsapp.service"));

  const passed = checks.filter((check) => check.passed).length;
  return {
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      strictAcceptance: passed === checks.length,
    },
    activeProvider: env.whatsappProvider,
    inactiveLegacyLocations: [
      "src/modules/whatsapp/whatsapp.service.ts",
      "package.json: @whiskeysockets/baileys",
    ],
    checks,
  };
}
