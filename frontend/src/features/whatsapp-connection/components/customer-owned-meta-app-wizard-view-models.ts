import type { CurrentWhatsAppConnection, DiscoveredWhatsAppPhone } from "../services/embedded-signup-completion-service";
import type { CustomerOwnedMetaAppWizardMode, WizardStep } from "./customer-owned-meta-app-wizard-types";

export const WIZARD_STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "prepare", label: "Prepare Meta" },
  { id: "credentials", label: "Credentials" },
  { id: "number", label: "WhatsApp number" },
  { id: "connection", label: "Connection" },
];

export const CONNECTION_PROGRESS_ITEMS = [
  "Meta credentials verified",
  "WhatsApp number selected",
  "Secure webhook configured",
  "Phone registration checked",
  "Connection activated",
] as const;

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((item) => item.id === step);
}

export function connectionStepFromStatus(connection: CurrentWhatsAppConnection | null): WizardStep {
  if (connection?.connectionMethod !== "CUSTOMER_OWNED_META_APP") return "prepare";
  if (connection.status === "VERIFYING") return "connection";
  if (connection.status === "PENDING") return "number";
  if (connection.status === "ERROR" || connection.status === "ACTION_REQUIRED") return "credentials";
  return "prepare";
}

export function statusText(value: string | null): string {
  if (!value) return "Status not available";
  return value
    .toLowerCase()
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function selectedPhoneLabel(phone: Pick<DiscoveredWhatsAppPhone, "maskedPhoneNumber" | "verifiedName"> | null): string {
  if (!phone) return "Selected WhatsApp number";
  return [phone.maskedPhoneNumber, phone.verifiedName].filter(Boolean).join(" - ") || "Selected WhatsApp number";
}

export function setupTitle(mode: CustomerOwnedMetaAppWizardMode): string {
  if (mode === "replace") return "Replace with your Meta App";
  if (mode === "resume") return "Resume guided setup";
  return "Connect your Meta App";
}
