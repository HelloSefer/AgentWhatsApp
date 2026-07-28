import type { LucideIcon } from "lucide-react";

export type OverviewStatusTone = "success" | "warning" | "muted" | "danger";

export type OverviewAction = Readonly<{
  label: string;
  href?: string;
  status?: "available" | "soon";
}>;

export type LaunchStageState = "completed" | "current" | "upcoming" | "soon" | "action_required";

export type LaunchStage = Readonly<{
  label: string;
  description: string;
  state: LaunchStageState;
}>;

export type OperationalStatusCardModel = Readonly<{
  title: string;
  description: string;
  statusLabel: string;
  tone: OverviewStatusTone;
  icon: LucideIcon;
  details?: readonly { label: string; value: string }[];
  action?: OverviewAction;
}>;

export type DashboardOverviewViewModel = Readonly<{
  storeDisplayName: string;
  launchDescription: string;
  completedStages: number;
  totalStages: number;
  stages: readonly LaunchStage[];
  primaryAction?: OverviewAction;
  operationalCards: readonly OperationalStatusCardModel[];
}>;
