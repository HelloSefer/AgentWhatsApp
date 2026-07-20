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

async function sourceExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
    return true;
  } catch (_error) {
    return false;
  }
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
    packageSource,
    packageLockSource,
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
    source("package.json"),
    source("package-lock.json"),
  ]);
  const legacyBaileysServiceExists = await sourceExists(
    "src/modules/whatsapp/whatsapp.service.ts",
  );
  const packageManifest = JSON.parse(packageSource) as Readonly<{
    dependencies?: Readonly<Record<string, string>>;
    devDependencies?: Readonly<Record<string, string>>;
  }>;
  const hasPackage = (packageName: string): boolean =>
    Boolean(
      packageManifest.dependencies?.[packageName] ||
        packageManifest.devDependencies?.[packageName],
    );

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
  add(checks, "Cloud API is the only accepted startup provider", serverSource.includes('if (env.whatsappProvider === "cloud_api")') && serverSource.includes("Cloud API is the only active runtime transport"));
  add(checks, "Baileys source service is removed", !legacyBaileysServiceExists);
  add(checks, "Baileys package is absent from dependencies", !hasPackage("@whiskeysockets/baileys"));
  add(checks, "Baileys package is absent from lockfile", !packageLockSource.includes("@whiskeysockets/baileys"));
  add(checks, "QR-only packages are absent from dependencies", !hasPackage("qrcode-terminal") && !hasPackage("@types/qrcode-terminal"));
  add(checks, "QR-only packages are absent from lockfile", !packageLockSource.includes("qrcode-terminal"));
  add(checks, "backend startup has no Baileys socket startup", !/whatsapp\.service|startWhatsApp|makeWASocket|baileys/i.test(serverSource));
  add(checks, "unsupported providers remain disabled at startup", serverSource.includes("Cloud API is the only active runtime transport") && !serverSource.includes("startWhatsApp("));
  add(checks, "active Cloud path has no unofficial package import", !/@whiskeysockets\/baileys|whatsapp-web\.js|venom|wppconnect/i.test(activeMessagingSources));
  add(checks, "guarded order runtime has no provider dependency", !/modules\/whatsapp|whatsapp\.service|baileys|sendMessage\(/i.test(runtimeSource));
  add(checks, "confirmed receipt adapter has no transport dependency", !/modules\/whatsapp|graph\.facebook\.com|sendDocument\(|sendMessage\(/i.test(receiptAdapterSource));
  add(checks, "Cloud transport uses official Graph API", cloudSource.includes('const GRAPH_API_BASE_URL = "https://graph.facebook.com"') && cloudSource.includes("postCloudMessage("));
  add(checks, "receipt documents use Cloud upload and document send", cloudSource.includes("uploadMedia({") && cloudSource.includes("type: \"document\"") && cloudSource.includes("const transport = input.transport || sendDocument"));
  add(checks, "Cloud failures never fall back to an unofficial provider", !/baileys|whatsapp\.service|startWhatsApp|makeWASocket|whatsapp-web\.js|venom|wppconnect/i.test(`${cloudSource}\n${cloudDispatchSource}`));
  add(checks, "QR session startup is absent from active sources", !/useMultiFileAuthState|qrcode|qr-session|startWhatsApp|makeWASocket/i.test(activeMessagingSources));
  add(checks, "Puppeteer is absent from active messaging transport", !/puppeteer|playwright|selenium/i.test(activeMessagingSources));
  add(checks, "browser tooling is restricted to receipt rendering and previews", receiptRendererSource.includes('import("puppeteer")') && receiptPreviewSource.includes('import("puppeteer")'));
  add(checks, "no browser automation targets WhatsApp Web", !/web\.whatsapp\.com|whatsapp web/i.test(`${activeMessagingSources}\n${receiptRendererSource}\n${receiptPreviewSource}`));
  add(checks, "no legacy Baileys service remains", !legacyBaileysServiceExists && !packageLockSource.includes("@whiskeysockets/baileys"));

  const passed = checks.filter((check) => check.passed).length;
  return {
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      strictAcceptance: passed === checks.length,
    },
    activeProvider: env.whatsappProvider,
    inactiveLegacyLocations: [],
    checks,
  };
}
