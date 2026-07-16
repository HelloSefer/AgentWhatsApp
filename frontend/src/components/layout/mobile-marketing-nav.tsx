"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SiteLogo } from "@/components/shared/site-logo";

export function MobileMarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        aria-label="Open navigation menu"
        render={<Button className="size-11" size="icon" variant="ghost" />}
      >
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(22rem,calc(100vw-1rem))] bg-marketing-surface">
        <SheetHeader className="border-b border-marketing-border pb-5">
          <SheetTitle>
            <SiteLogo />
          </SheetTitle>
          <SheetDescription>AI sales automation for WhatsApp commerce.</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="grid gap-1 px-4 py-2">
          {siteConfig.navigation.map((item) => (
            <Link
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-marketing-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto grid gap-2 p-4">
          <Link
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-full",
            })}
            href={siteConfig.actions.login.href}
            onClick={() => setOpen(false)}
          >
            {siteConfig.actions.login.label}
          </Link>
          <Link
            className={buttonVariants({
              className:
                "h-11 w-full bg-marketing-primary text-marketing-primary-foreground hover:bg-marketing-primary/90",
            })}
            href={siteConfig.actions.getStarted.href}
            onClick={() => setOpen(false)}
          >
            {siteConfig.actions.getStarted.label}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
