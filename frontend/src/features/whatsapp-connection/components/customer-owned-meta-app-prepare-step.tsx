"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const META_DEVELOPERS_URL = "https://developers.facebook.com/";

export function CustomerOwnedMetaAppPrepareStep({ onReady }: Readonly<{ onReady: () => void }>) {
  const [helpOpen, setHelpOpen] = useState(false);
  const checklist = [
    "Facebook account",
    "Meta Business Portfolio",
    "Meta App with WhatsApp added",
    "WhatsApp Business Account and phone number",
    "System User with access to the App and WhatsApp Account",
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Prepare Meta</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          You will use assets owned by your business in Meta. AgentWhatsApp checks access through the backend before activating the number.
        </p>
      </div>

      <ul className="grid gap-2">
        {checklist.map((item) => (
          <li className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm" key={item}>
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-border bg-muted/30">
        <button
          aria-expanded={helpOpen}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setHelpOpen((value) => !value)}
          type="button"
        >
          Where do I find this?
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform motion-reduce:transition-none", helpOpen && "rotate-180")} />
        </button>
        {helpOpen ? (
          <div className="space-y-3 border-t border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
            <p>Open Meta for Developers, choose your business app, and confirm WhatsApp is added to it.</p>
            <p>In Business settings, confirm your System User has access to the app and the WhatsApp Business Account.</p>
            <Button className="min-h-11 w-full sm:w-auto" render={<a href={META_DEVELOPERS_URL} rel="noopener noreferrer" target="_blank" />} type="button" variant="outline">
              <ExternalLink aria-hidden="true" />
              Open Meta for Developers
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" onClick={onReady} type="button">
          I&apos;m ready
        </Button>
      </div>
    </div>
  );
}
