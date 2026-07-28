"use client";

import { FormEvent, useState } from "react";
import { AppWindow, ArrowLeft, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EMPTY_CREDENTIALS, type CredentialsForm } from "./customer-owned-meta-app-wizard-types";

export function CustomerOwnedMetaAppCredentialsStep({
  error,
  isSubmitting,
  onBack,
  onSubmit,
}: Readonly<{
  error: string | null;
  isSubmitting: boolean;
  onBack: () => void;
  onSubmit: (input: CredentialsForm) => void;
}>) {
  const [values, setValues] = useState<CredentialsForm>(EMPTY_CREDENTIALS);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const inputClassName =
    "min-h-11 border-marketing-border bg-background/80 focus-visible:border-emerald-600 focus-visible:ring-emerald-600/20";
  const secretToggleClassName =
    "absolute top-1/2 right-1 min-h-11 min-w-11 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:border-emerald-600 focus-visible:ring-emerald-600/20";
  const tokenToggleClassName =
    "absolute top-1 right-1 min-h-11 min-w-11 text-muted-foreground hover:text-foreground focus-visible:border-emerald-600 focus-visible:ring-emerald-600/20";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const appId = values.appId.trim();
    const appSecret = values.appSecret.trim();
    const systemUserAccessToken = values.systemUserAccessToken.trim();

    if (!appId || !appSecret || !systemUserAccessToken) {
      setFormError("Enter the Meta App ID, App Secret, and System User token.");
      return;
    }

    setFormError(null);
    onSubmit({ appId, appSecret, systemUserAccessToken });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <h3 className="text-lg font-semibold text-foreground">Enter credentials</h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
          Enter the Meta credentials used to securely connect your WhatsApp Business account.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50/45 px-3 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-emerald-700 ring-1 ring-emerald-100">
          <LockKeyhole aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-950">Encrypted and hidden after submission</p>
          <p className="mt-0.5 text-xs leading-5 text-emerald-950/75">
            AgentWhatsApp stores these credentials securely and does not display them again.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-marketing-border bg-muted/35 p-3 sm:p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="gap-1.5" htmlFor="manual-app-id">
              <AppWindow aria-hidden="true" className="size-4 text-emerald-700" />
              Meta App ID
            </Label>
            <Input
              aria-describedby="manual-app-id-help"
              aria-invalid={Boolean(formError && !values.appId.trim())}
              autoComplete="off"
              className={inputClassName}
              id="manual-app-id"
              inputMode="numeric"
              onChange={(event) => setValues((current) => ({ ...current, appId: event.target.value }))}
              type="text"
              value={values.appId}
            />
            <p className="text-xs leading-5 text-muted-foreground" id="manual-app-id-help">Found in your Meta App dashboard.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="gap-1.5" htmlFor="manual-app-secret">
              <KeyRound aria-hidden="true" className="size-4 text-emerald-700" />
              Meta App Secret
            </Label>
            <div className="relative">
              <Input
                aria-describedby="manual-app-secret-help"
                aria-invalid={Boolean(formError && !values.appSecret.trim())}
                autoComplete="new-password"
                className={cn(inputClassName, "pr-14")}
                id="manual-app-secret"
                onChange={(event) => setValues((current) => ({ ...current, appSecret: event.target.value }))}
                type={showSecret ? "text" : "password"}
                value={values.appSecret}
              />
              <Button
                aria-label={showSecret ? "Hide Meta App Secret" : "Show Meta App Secret"}
                aria-pressed={showSecret}
                className={secretToggleClassName}
                onClick={() => setShowSecret((value) => !value)}
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                {showSecret ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground" id="manual-app-secret-help">
              Used to confirm that the access token belongs to your App.
            </p>
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label className="gap-1.5" htmlFor="manual-system-user-token">
              <ShieldCheck aria-hidden="true" className="size-4 text-emerald-700" />
              System User Access Token
            </Label>
            <div className="relative">
              <Textarea
                aria-describedby="manual-system-user-token-help"
                aria-invalid={Boolean(formError && !values.systemUserAccessToken.trim())}
                autoComplete="new-password"
                className={cn(
                  inputClassName,
                  "min-h-24 resize-y pr-14",
                  !showToken && "[text-security:disc] [-webkit-text-security:disc]",
                )}
                id="manual-system-user-token"
                onChange={(event) => setValues((current) => ({ ...current, systemUserAccessToken: event.target.value }))}
                value={values.systemUserAccessToken}
              />
              <Button
                aria-label={showToken ? "Hide System User Access Token" : "Show System User Access Token"}
                aria-pressed={showToken}
                className={tokenToggleClassName}
                onClick={() => setShowToken((value) => !value)}
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                {showToken ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground" id="manual-system-user-token-help">
              Generate a token for a System User with access to your App and WhatsApp Business Account.
            </p>
          </div>
        </div>
      </div>

      {formError || error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-foreground" id="manual-credentials-error" role="alert">
          {formError ?? error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-marketing-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button className="min-h-11 w-full sm:w-auto" disabled={isSubmitting} onClick={onBack} type="button" variant="outline">
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="text-xs leading-5 text-muted-foreground">Meta will verify your App and available WhatsApp accounts.</p>
          <Button aria-busy={isSubmitting} className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden="true" />}
            Verify and continue
          </Button>
        </div>
      </div>
    </form>
  );
}
