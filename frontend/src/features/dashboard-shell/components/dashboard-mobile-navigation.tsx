"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { SiteLogo } from "@/components/shared/site-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { dashboardNavigationSections } from "../config/dashboard-navigation";
import { isDashboardNavigationItemActive } from "../utils/dashboard-route-matching";
import { DashboardNavigationItem } from "./dashboard-navigation-item";
import { DashboardUserMenu } from "./dashboard-user-menu";

export function DashboardMobileNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        render={
          <Button aria-label="Open dashboard navigation" className="min-h-11 min-w-11 lg:hidden" size="icon-lg" type="button" variant="ghost">
            <Menu aria-hidden="true" />
          </Button>
        }
      />
      <SheetContent className="w-[min(20rem,calc(100vw-1rem))] gap-0 bg-white p-0" side="left">
        <SheetHeader className="border-b border-marketing-border px-5 py-4">
          <SheetTitle>
            <SiteLogo className="text-[0.95rem]" />
          </SheetTitle>
          <SheetDescription className="sr-only">Dashboard sections and workspace actions</SheetDescription>
        </SheetHeader>
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
                      onNavigate={() => setOpen(false)}
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
      </SheetContent>
    </Sheet>
  );
}
