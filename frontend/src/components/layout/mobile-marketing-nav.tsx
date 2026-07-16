"use client";

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
  return (
    <Sheet>
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
        <div className="mt-auto grid gap-2 p-4">
          <Link
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-full",
            })}
            href={siteConfig.actions.login.href}
          >
            {siteConfig.actions.login.label}
          </Link>
          <Link
            className={buttonVariants({
              className:
                "h-11 w-full bg-marketing-primary text-marketing-primary-foreground hover:bg-marketing-primary/90",
            })}
            href={siteConfig.actions.getStarted.href}
          >
            {siteConfig.actions.getStarted.label}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
