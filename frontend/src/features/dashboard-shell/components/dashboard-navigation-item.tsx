"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DashboardNavigationItem as DashboardNavigationItemModel } from "../types/dashboard-navigation.types";

type DashboardNavigationItemProps = Readonly<{
  item: DashboardNavigationItemModel;
  active: boolean;
  onNavigate?: () => void;
}>;

export function DashboardNavigationItem({ item, active, onNavigate }: DashboardNavigationItemProps) {
  const Icon = item.icon;
  const baseClassName =
    "group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const content = (
    <>
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "text-marketing-primary" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      {item.status === "soon" ? (
        <Badge className="h-5 rounded-md border-marketing-border px-1.5 text-[0.68rem] font-semibold" variant="outline">
          Soon
        </Badge>
      ) : null}
    </>
  );

  if (!item.href || item.status === "soon") {
    return (
      <div
        aria-disabled="true"
        className={cn(baseClassName, "cursor-not-allowed text-muted-foreground opacity-70")}
        role="link"
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        baseClassName,
        active
          ? "bg-marketing-subtle text-foreground ring-1 ring-marketing-border"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      href={item.href}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}
