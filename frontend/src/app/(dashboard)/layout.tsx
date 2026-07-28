import type { ReactNode } from "react";
import { DashboardAuthGuard } from "@/features/auth/components/dashboard-auth-guard";
import { DashboardShell } from "@/features/dashboard-shell/components/dashboard-shell";

type DashboardLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <DashboardAuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </DashboardAuthGuard>
  );
}
