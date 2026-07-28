import { Boxes, MessageCircle, MessageSquareText, PackageCheck } from "lucide-react";
import type { WorkspaceSummary } from "@/features/onboarding/types/onboarding-contracts";
import type { CurrentWhatsAppConnection, WhatsAppConnectionStatus } from "@/features/whatsapp-connection/services/embedded-signup-completion-service";
import type {
  DashboardOverviewViewModel,
  LaunchStageState,
  OperationalStatusCardModel,
  OverviewAction,
  OverviewStatusTone,
} from "./dashboard-overview.types";

const WHATSAPP_SETTINGS_HREF = "/dashboard/settings/whatsapp";

function whatsappStatusLabel(status: WhatsAppConnectionStatus | null): string {
  if (status === "ACTIVE") return "Connected";
  if (status === "PENDING" || status === "VERIFYING" || status === "REPLACEMENT_PENDING") return "Setup in progress";
  if (status === "ACTION_REQUIRED" || status === "ERROR" || status === "REVOKED") return "Action required";
  return "Not connected";
}

function whatsappTone(status: WhatsAppConnectionStatus | null): OverviewStatusTone {
  if (status === "ACTIVE") return "success";
  if (status === "PENDING" || status === "VERIFYING" || status === "REPLACEMENT_PENDING") return "warning";
  if (status === "ACTION_REQUIRED" || status === "ERROR" || status === "REVOKED") return "danger";
  return "muted";
}

function whatsappStageState(status: WhatsAppConnectionStatus | null): LaunchStageState {
  if (status === "ACTIVE") return "completed";
  if (status === "ACTION_REQUIRED" || status === "ERROR" || status === "REVOKED") return "action_required";
  return "current";
}

function whatsappDescription(status: WhatsAppConnectionStatus | null): string {
  if (status === "ACTIVE") return "Your verified WhatsApp Business connection is available.";
  if (status === "PENDING" || status === "VERIFYING") return "Finish the guided setup and backend verification.";
  if (status === "REPLACEMENT_PENDING") return "A replacement connection is being prepared.";
  if (status === "ACTION_REQUIRED" || status === "ERROR" || status === "REVOKED") return "Review the connection settings to continue safely.";
  return "Connect a WhatsApp Business number to activate customer messaging.";
}

function whatsappPrimaryAction(status: WhatsAppConnectionStatus | null): OverviewAction | undefined {
  if (status === "ACTIVE") return undefined;
  if (status === "PENDING" || status === "VERIFYING" || status === "REPLACEMENT_PENDING") {
    return { label: "Continue WhatsApp setup", href: WHATSAPP_SETTINGS_HREF, status: "available" };
  }
  return { label: "Connect WhatsApp", href: WHATSAPP_SETTINGS_HREF, status: "available" };
}

function buildWhatsappCard(connection: CurrentWhatsAppConnection | null): OperationalStatusCardModel {
  const status = connection?.status ?? null;
  const details = [
    ...(connection?.maskedPhoneNumber ? [{ label: "Number", value: connection.maskedPhoneNumber }] : []),
    ...(connection?.health ? [{ label: "Health", value: connection.health }] : []),
  ];

  return {
    title: "WhatsApp connection",
    description: whatsappDescription(status),
    statusLabel: whatsappStatusLabel(status),
    tone: whatsappTone(status),
    icon: MessageCircle,
    details,
    action: {
      label: status === "ACTIVE" ? "Manage connection" : status === null ? "Connect WhatsApp" : "Open settings",
      href: WHATSAPP_SETTINGS_HREF,
      status: "available",
    },
  };
}

export function buildDashboardOverviewViewModel(
  workspace: WorkspaceSummary,
  connection: CurrentWhatsAppConnection | null,
): DashboardOverviewViewModel {
  const whatsappStatus = connection?.status ?? null;
  const whatsappCompleted = whatsappStatus === "ACTIVE";
  const completedStages = 1 + (whatsappCompleted ? 1 : 0);
  const primaryAction = whatsappPrimaryAction(whatsappStatus);

  const operationalCards: OperationalStatusCardModel[] = [
    buildWhatsappCard(connection),
    {
      title: "Products",
      description: "Catalog setup is not available in the dashboard yet.",
      statusLabel: "Soon",
      tone: "muted",
      icon: Boxes,
    },
    {
      title: "Orders",
      description: "Confirmed orders will appear after commerce setup is available.",
      statusLabel: "Soon",
      tone: "muted",
      icon: PackageCheck,
    },
    {
      title: "Agent readiness",
      description: whatsappCompleted
        ? "WhatsApp is connected. Commerce setup is still needed before live order handling is ready."
        : whatsappStatus === "PENDING" || whatsappStatus === "VERIFYING" || whatsappStatus === "REPLACEMENT_PENDING"
          ? "Waiting for WhatsApp setup to finish before customer conversations can be handled."
          : "Waiting for a WhatsApp connection before customer conversations can be handled.",
      statusLabel: whatsappCompleted ? "Waiting on commerce setup" : whatsappStatusLabel(whatsappStatus),
      tone: whatsappCompleted ? "warning" : whatsappTone(whatsappStatus),
      icon: MessageSquareText,
    },
  ];

  return {
    storeDisplayName: workspace.displayName,
    launchDescription: whatsappCompleted
      ? "Your WhatsApp connection is available. Product and order setup will unlock the remaining launch path."
      : "Your workspace is ready. Connect WhatsApp next to prepare AgentWhatsApp for customer conversations.",
    completedStages,
    totalStages: 4,
    primaryAction,
    stages: [
      {
        label: "Store profile",
        description: "Workspace identity is created.",
        state: "completed",
      },
      {
        label: "Connect WhatsApp",
        description: whatsappDescription(whatsappStatus),
        state: whatsappStageState(whatsappStatus),
      },
      {
        label: "Add products",
        description: "Catalog setup is not available yet.",
        state: "soon",
      },
      {
        label: "Start receiving orders",
        description: "Order operations will follow commerce setup.",
        state: "soon",
      },
    ],
    operationalCards,
  };
}
