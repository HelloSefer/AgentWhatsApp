import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import type { FinalizeStage } from "./customer-owned-meta-app-wizard-types";
import { CONNECTION_PROGRESS_ITEMS } from "./customer-owned-meta-app-wizard-view-models";

export function CustomerOwnedMetaAppConnectionStep({
  connectionLabel,
  error,
  stage,
  onDone,
  onRetry,
}: Readonly<{
  connectionLabel: string;
  error: string | null;
  stage: FinalizeStage;
  onDone: () => void;
  onRetry: () => void;
}>) {
  const configured = stage === "configured" || stage === "finalizing" || stage === "done";
  const finalized = stage === "done";
  const currentOperation =
    stage === "configuring"
      ? "Configuring the secure webhook."
      : stage === "finalizing"
        ? "Checking phone registration and activating the connection."
        : stage === "done"
          ? "WhatsApp connected."
          : stage === "error"
            ? "The last step needs attention."
            : "Ready to continue.";

  const completeCount = 2 + (configured ? 1 : 0) + (finalized ? 2 : 0);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{stage === "done" ? "WhatsApp connected" : "Configure and activate"}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground" aria-live="polite">
          {stage === "done"
            ? "AgentWhatsApp can now receive and reply to customer messages through this WhatsApp number."
            : currentOperation}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">{connectionLabel}</p>
        {stage === "done" ? <Badge className="mt-2 bg-emerald-600 text-white">Healthy</Badge> : null}
      </div>

      <ol className="space-y-2" aria-live="polite">
        {CONNECTION_PROGRESS_ITEMS.map((item, index) => {
          const done = index < completeCount;
          const active = !done && ((stage === "configuring" && index === 2) || (stage === "finalizing" && index >= 3));

          return (
            <li className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm" key={item}>
              {active ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin text-emerald-700 motion-reduce:animate-none" />
              ) : done ? (
                <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
              ) : (
                <span aria-hidden="true" className="size-4 rounded-full border border-border bg-muted" />
              )}
              <span>{item}</span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-foreground" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col justify-end gap-2 sm:flex-row">
        {stage === "done" ? (
          <Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" onClick={onDone} type="button">
            Done
          </Button>
        ) : (
          <Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" disabled={stage === "configuring" || stage === "finalizing"} onClick={onRetry} type="button">
            {stage === "configuring" || stage === "finalizing" ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden="true" />}
            {stage === "error" ? "Retry connection" : "Connect WhatsApp"}
          </Button>
        )}
      </div>
    </div>
  );
}
