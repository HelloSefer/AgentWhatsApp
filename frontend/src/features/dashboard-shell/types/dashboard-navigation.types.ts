import type { LucideIcon } from "lucide-react";

export type DashboardNavigationMatch = "exact" | "prefix";

export type DashboardNavigationStatus = "available" | "soon";

export type DashboardNavigationItem = Readonly<{
  label: string;
  href?: string;
  icon: LucideIcon;
  match?: DashboardNavigationMatch;
  status?: DashboardNavigationStatus;
  requiredPermission?: string;
}>;

export type DashboardNavigationSection = Readonly<{
  label: string;
  items: readonly DashboardNavigationItem[];
}>;

export type DashboardPageMeta = Readonly<{
  title: string;
  breadcrumb?: readonly string[];
}>;
