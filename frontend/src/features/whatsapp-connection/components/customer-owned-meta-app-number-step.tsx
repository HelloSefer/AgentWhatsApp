"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, CheckCircle2, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscoveredWhatsAppPhone, ManualDiscoveryResult } from "../services/embedded-signup-completion-service";
import { statusText } from "./customer-owned-meta-app-wizard-view-models";

export function CustomerOwnedMetaAppNumberStep({
  discovery,
  error,
  isLoading,
  isSelecting,
  onBack,
  onRefresh,
  onSelect,
}: Readonly<{
  discovery: ManualDiscoveryResult | null;
  error: string | null;
  isLoading: boolean;
  isSelecting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSelect: (phone: DiscoveredWhatsAppPhone) => void;
}>) {
  const phones = useMemo(() => discovery?.accounts.flatMap((account) => account.phones) ?? [], [discovery]);
  const [selectedId, setSelectedId] = useState<string>("");
  const selectedPhone = phones.find((phone) => phone.phoneNumberId === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Choose WhatsApp number</h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
            Choose the WhatsApp number AgentWhatsApp should use.
          </p>
        </div>
        <Button className="min-h-11 w-full sm:w-auto" disabled={isLoading || isSelecting} onClick={onRefresh} type="button" variant="outline">
          {isLoading ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex min-h-32 items-center gap-3 rounded-xl border border-border bg-muted/30 p-4" role="status">
          <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
          <p className="text-sm text-muted-foreground">Finding your WhatsApp Business Accounts.</p>
        </div>
      ) : null}

      {!isLoading && discovery?.accounts.length === 0 ? (
        <div className="rounded-xl border border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
          No accessible WhatsApp Business Account was found. Check the System User access in Meta, then refresh.
        </div>
      ) : null}

      <div className="space-y-4">
        {discovery?.accounts.map((account) => (
          <section className="rounded-xl border border-marketing-border bg-marketing-canvas p-3" key={account.wabaId}>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-foreground">{account.name ?? "WhatsApp Business Account"}</h4>
              {account.status ? <Badge className="rounded-md" variant="secondary">{statusText(account.status)}</Badge> : null}
            </div>

            {account.phones.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No accessible phone numbers were returned for this account.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {account.phones.map((phone) => (
                  <label
                    className={cn(
                      "relative flex cursor-pointer gap-3 rounded-xl border bg-white p-3 outline-none transition-colors focus-within:ring-3 focus-within:ring-ring/50",
                      selectedId === phone.phoneNumberId ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300" : "border-marketing-border hover:bg-muted/30",
                    )}
                    key={phone.phoneNumberId}
                  >
                    <input
                      checked={selectedId === phone.phoneNumberId}
                      className="mt-1 size-4 accent-emerald-600"
                      name="whatsapp-phone"
                      onChange={() => setSelectedId(phone.phoneNumberId)}
                      type="radio"
                      value={phone.phoneNumberId}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 pr-8">
                        <Smartphone aria-hidden="true" className="size-4 text-emerald-700" />
                        <span className="font-semibold text-foreground">{phone.maskedPhoneNumber ?? "Masked number not available"}</span>
                        {selectedId === phone.phoneNumberId ? (
                          <Badge className="rounded-md bg-emerald-600 text-white">Selected</Badge>
                        ) : null}
                      </span>
                      <span className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                        <span><span className="font-medium text-foreground">Business</span><br />{phone.verifiedName ?? "Not available"}</span>
                        <span><span className="font-medium text-foreground">Status</span><br />{statusText(phone.status)}</span>
                        <span><span className="font-medium text-foreground">Verification</span><br />{statusText(phone.verificationStatus)}</span>
                      </span>
                      {selectedId === phone.phoneNumberId ? (
                        <CheckCircle2 aria-hidden="true" className="absolute right-3 top-3 size-5 text-emerald-600" />
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-foreground" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col justify-between gap-2 border-t border-marketing-border pt-4 sm:flex-row">
        <Button className="min-h-11 w-full sm:w-auto" disabled={isLoading || isSelecting} onClick={onBack} type="button" variant="outline">
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <Button
          className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
          disabled={!selectedPhone || isSelecting}
          onClick={() => selectedPhone && onSelect(selectedPhone)}
          type="button"
        >
          {isSelecting ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" />}
          Use this WhatsApp number
        </Button>
      </div>
    </div>
  );
}
