"use client";

import { usePathname } from "next/navigation";
import { SiteLogo } from "@/components/shared/site-logo";
import { dashboardNavigationSections } from "../config/dashboard-navigation";
import { isDashboardNavigationItemActive } from "../utils/dashboard-route-matching";
import { DashboardNavigationItem } from "./dashboard-navigation-item";
import { DashboardUserMenu } from "./dashboard-user-menu";

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-[16rem] shrink-0 border-r border-marketing-border bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col">
      <div className="flex h-16 items-center border-b border-marketing-border px-5">
        <SiteLogo className="text-[0.95rem]" />
      </div>
      <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {dashboardNavigationSections.map((section) => (
            <section aria-label={section.label} className="space-y-1.5" key={section.label}>
              <p className="px-3 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {section.label}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <DashboardNavigationItem
                    active={isDashboardNavigationItemActive(item, pathname)}
                    item={item}
                    key={item.label}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </nav>
      <div className="border-t border-marketing-border p-4">
        <DashboardUserMenu />
      </div>
    </aside>
  );
}
