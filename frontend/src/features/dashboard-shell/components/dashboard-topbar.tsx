"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { dashboardPageMetaForPath } from "../utils/dashboard-route-matching";
import { DashboardMobileNavigation } from "./dashboard-mobile-navigation";

function userInitial(email: string | undefined): string {
  return email?.trim().charAt(0).toLocaleUpperCase() || "A";
}

export function DashboardTopbar() {
  const pathname = usePathname();
  const auth = useAuthSession();
  const meta = dashboardPageMetaForPath(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-marketing-border bg-white px-3 sm:px-5 lg:pl-6">
      <DashboardMobileNavigation />
      <div className="min-w-0 flex-1">
        {meta.breadcrumb ? (
          <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-xs font-medium text-muted-foreground sm:flex">
            {meta.breadcrumb.map((part, index) => (
              <span className="inline-flex items-center gap-1" key={`${part}-${index}`}>
                {index > 0 ? <ChevronRight aria-hidden="true" className="size-3" /> : null}
                <span>{part}</span>
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{meta.title}</h1>
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-marketing-border bg-background px-2 py-1.5">
        <Avatar className="size-7 bg-marketing-subtle" size="sm">
          <AvatarFallback className="bg-marketing-subtle font-semibold text-marketing-primary">
            {userInitial(auth.user?.emailNormalized)}
          </AvatarFallback>
        </Avatar>
        <div className="hidden min-w-0 sm:block">
          <p className="max-w-44 truncate text-xs font-semibold text-foreground">{auth.user?.emailNormalized ?? "Workspace user"}</p>
          <p className="text-[0.68rem] font-medium text-muted-foreground">{auth.memberships[0]?.role ?? "Member"}</p>
        </div>
      </div>
    </header>
  );
}
