import type { WorkspaceSummary } from "@/features/onboarding/types/onboarding-contracts";

export function workspaceInitials(displayName: string): string {
  const normalized = displayName.trim().replace(/\s+/gu, " ");
  if (!normalized) return "AW";
  const parts = normalized.split(" ").filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
    : normalized.slice(0, 2);
  return initials.toLocaleUpperCase();
}

export function readableWhatsappStatus(status: WorkspaceSummary["whatsappStatus"]): string {
  if (status === "NOT_CONNECTED") return "Not connected";
  return "Not connected";
}
