import type { ReactNode } from "react";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardTopbar } from "./dashboard-topbar";

type DashboardShellProps = Readonly<{
  children: ReactNode;
}>;

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-marketing-canvas text-foreground">
      <DashboardSidebar />
      <div className="min-h-screen lg:pl-64">
        <DashboardTopbar />
        <main className="min-w-0 overflow-x-hidden px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
