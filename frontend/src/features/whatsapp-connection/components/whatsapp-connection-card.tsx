"use client";

import { CheckCircle2, Loader2, MessageCircle, PlugZap, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMetaEmbeddedSignupConfig } from "../config/meta-embedded-signup-config";
import { useMetaEmbeddedSignup } from "../hooks/use-meta-embedded-signup";

function statusCopy(status: ReturnType<typeof useMetaEmbeddedSignup>["status"], message: string | null): string {
  if (message) return message;
  if (status === "verified") return "WhatsApp connection verified.";
  if (status === "cancelled") return "WhatsApp connection was cancelled.";
  if (status === "error") return "WhatsApp connection could not be completed.";
  return "Not connected.";
}

export function WhatsappConnectionCard() {
  const configState = getMetaEmbeddedSignupConfig();
  const signup = useMetaEmbeddedSignup({ configState });
  const isNotConfigured = !configState.isConfigured;
  const buttonDisabled = isNotConfigured || !signup.canLaunch;
  const isSuccess = signup.status === "verified";
  const isError = signup.status === "error" || signup.status === "cancelled" || signup.status === "not_configured";

  return (
    <Card className="rounded-2xl border-marketing-border bg-marketing-surface shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)]">
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Settings</p>
          <CardTitle className="mt-2 text-2xl font-semibold text-foreground">WhatsApp connection</CardTitle>
          <CardDescription className="mt-2 max-w-2xl leading-6">
            Connect a WhatsApp Business account through Meta Embedded Signup. AgentWhatsApp will mark the setup complete only after backend verification.
          </CardDescription>
        </div>
        <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-marketing-subtle text-marketing-primary ring-1 ring-marketing-border">
          <MessageCircle className="size-5" />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl border border-marketing-border bg-marketing-canvas p-4">
          <div className="flex items-start gap-3">
            {isSuccess ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-marketing-primary" />
            ) : isError ? (
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
            ) : (
              <PlugZap aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{isSuccess ? "Verified" : isNotConfigured ? "Not configured" : "Disconnected"}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{statusCopy(signup.status, signup.message)}</p>
              {isNotConfigured ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Missing public Meta configuration: {configState.missingKeys.join(", ")}.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <Button
          aria-busy={signup.isBusy}
          className="min-h-11 w-full whitespace-normal text-center sm:w-auto"
          disabled={buttonDisabled}
          onClick={signup.launch}
          type="button"
        >
          {signup.isBusy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <PlugZap aria-hidden="true" />}
          {signup.status === "finalizing" ? "Verifying..." : signup.isBusy ? "Connecting..." : "Connect WhatsApp"}
        </Button>
      </CardContent>
    </Card>
  );
}
