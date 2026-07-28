import { dashboardPageMeta } from "../config/dashboard-navigation";
import type { DashboardNavigationItem, DashboardPageMeta } from "../types/dashboard-navigation.types";

export function isDashboardNavigationItemActive(item: DashboardNavigationItem, pathname: string | null): boolean {
  if (!item.href || !pathname) return false;
  if ((item.match ?? "prefix") === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function dashboardPageMetaForPath(pathname: string | null): DashboardPageMeta {
  const fallback: DashboardPageMeta = { title: "Dashboard" };
  if (!pathname) return fallback;

  const match = dashboardPageMeta.find((entry) => {
    if (entry.match === "exact") return pathname === entry.href;
    return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
  });

  return match?.meta ?? fallback;
}
