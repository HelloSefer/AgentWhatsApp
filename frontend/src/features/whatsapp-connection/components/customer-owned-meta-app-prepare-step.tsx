"use client";

import { AppWindow, Building2, ExternalLink, KeyRound, MessageCircle, UserRound } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const META_DEVELOPERS_URL = "https://developers.facebook.com/";

export function CustomerOwnedMetaAppPrepareStep({ onReady }: Readonly<{ onReady: () => void }>) {
  const checklist = [
    { label: "Facebook account", icon: UserRound },
    { label: "Meta Business Portfolio", icon: Building2 },
    { label: "Meta App with WhatsApp added", icon: AppWindow },
    { label: "WhatsApp Business Account and phone number", icon: MessageCircle },
    { label: "System User with access to the App and WhatsApp Account", icon: KeyRound, className: "sm:col-span-2" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Prepare Meta</h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
          Make sure these items are ready in your Meta account before continuing.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Preparation checklist</p>
        <ul className="grid gap-2 rounded-xl border border-marketing-border bg-marketing-canvas p-2.5 sm:grid-cols-2">
          {checklist.map((item) => {
            const Icon = item.icon;

            return (
              <li
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-marketing-border bg-white px-3 py-2.5 text-sm text-foreground",
                  item.className,
                )}
                key={item.label}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 pt-1 leading-5">{item.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 ring-1 ring-emerald-100 sm:flex">
            <ExternalLink aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Need to prepare your Meta account first?</p>
            <a
              className={cn(buttonVariants({ variant: "outline", className: "mt-2 min-h-11 w-full bg-white sm:w-auto" }))}
              href={META_DEVELOPERS_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" />
              Open Meta for Developers
            </a>
          </div>
        </div>
        <Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" onClick={onReady} type="button">
          I&apos;m ready
        </Button>
      </div>
    </div>
  );
}
