"use client";

import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import type { DashboardNavigationSection } from "@/features/dashboard-shell/types/dashboard-navigation.types";
import { developmentTenantService, developmentTenantStatusQueryKey } from "../services/development-tenant-service";

const developmentToolsSection: DashboardNavigationSection = {
  label: "Settings",
  items: [{
    label: "Development tools",
    href: "/dashboard/settings/development",
    icon: Wrench,
    match: "prefix",
    status: "available",
  }],
};

export function useDevelopmentTenantNavigation(): DashboardNavigationSection | null {
  const { memberships } = useAuthSession();
  const role = memberships[0]?.role;
  const query = useQuery({
    queryKey: developmentTenantStatusQueryKey,
    queryFn: developmentTenantService.loadStatus,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (role === "OWNER" || role === "ADMIN") && query.data?.status === "READY"
    ? developmentToolsSection
    : null;
}
