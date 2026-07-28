"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EMPTY_CREDENTIALS, type CredentialsForm } from "./customer-owned-meta-app-wizard-types";

export function CustomerOwnedMetaAppCredentialsStep({
  error,
  isSubmitting,
  onSubmit,
}: Readonly<{
  error: string | null;
  isSubmitting: boolean;
  onSubmit: (input: CredentialsForm) => void;
}>) {
  const [values, setValues] = useState<CredentialsForm>(EMPTY_CREDENTIALS);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    <form className="space-y-5" onSubmit={submit}>
      <div>
        <h3 className="text-lg font-semibold text-foreground">Enter credentials</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          These values are sent only when you submit this form. AgentWhatsApp stores the credentials securely on the backend.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="manual-app-id">Meta App ID</Label>
          <Input
            autoComplete="off"
            className="min-h-11"
            id="manual-app-id"
            inputMode="numeric"
            onChange={(event) => setValues((current) => ({ ...current, appId: event.target.value }))}
            type="text"
            value={values.appId}
          />
          <p className="text-xs leading-5 text-muted-foreground">Use the App ID from your Meta App dashboard. It is handled as text.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="manual-app-secret">Meta App Secret</Label>
          <div className="flex gap-2">
            <Input
              autoComplete="new-password"
              className="min-h-11"
              id="manual-app-secret"
              onChange={(event) => setValues((current) => ({ ...current, appSecret: event.target.value }))}
              type={showSecret ? "text" : "password"}
              value={values.appSecret}
            />
            <Button aria-label={showSecret ? "Hide App Secret" : "Show App Secret"} className="min-h-11" onClick={() => setShowSecret((value) => !value)} type="button" variant="outline">
              {showSecret ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Used once to verify the app connection. Do not share it with staff who should not manage Meta.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="manual-system-user-token">System User Access Token</Label>
          <div className="grid gap-2">
            <Textarea
              autoComplete="new-password"
              className={cn("min-h-24 resize-y", !showToken && "[text-security:disc] [-webkit-text-security:disc]")}
              id="manual-system-user-token"
              onChange={(event) => setValues((current) => ({ ...current, systemUserAccessToken: event.target.value }))}
              value={values.systemUserAccessToken}
            />
            <Button className="min-h-11 w-full sm:w-fit" onClick={() => setShowToken((value) => !value)} type="button" variant="outline">
              {showToken ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {showToken ? "Hide token" : "Show token"}
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Generate this for a System User that can access your app and WhatsApp Business Account.</p>
        </div>
      </div>

      {formError || error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-foreground" role="alert">
          {formError ?? error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button aria-busy={isSubmitting} className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden="true" />}
          Check and find my WhatsApp accounts
        </Button>
      </div>
    </form>
  );
}
