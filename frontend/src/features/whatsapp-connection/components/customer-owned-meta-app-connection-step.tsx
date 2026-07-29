import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Circle, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FinalizeStage, SelectedConnectionSummary } from "./customer-owned-meta-app-wizard-types";
import { CONNECTION_PROGRESS_ITEMS } from "./customer-owned-meta-app-wizard-view-models";

export function CustomerOwnedMetaAppConnectionStep({
  connectionLabel,
  connectionSummary,
  error,
  stage,
  onDone,
  onRetry,
  onUpdateCredentials,
}: Readonly<{
  connectionLabel: string;
  connectionSummary: SelectedConnectionSummary;
  error: string | null;
  stage: FinalizeStage;
  onDone: () => void;
  onRetry: () => void;
  onUpdateCredentials: () => void;
}>) {
  const configured = stage === "configured" || stage === "finalizing" || stage === "done";
  const finalized = stage === "done";
  const isBusy = stage === "configuring" || stage === "finalizing";
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
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{stage === "done" ? "WhatsApp connected" : "Configure and activate"}</h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground" aria-live="polite">
          {stage === "done"
            ? "AgentWhatsApp can now receive and reply to customer messages through this WhatsApp number."
            : currentOperation}
        </p>
      </div>

      <div className={cn("rounded-xl border p-4", stage === "done" ? "border-emerald-200 bg-emerald-50" : "border-marketing-border bg-white")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{connectionLabel}</p>
            {stage === "done" ? (
              <p className="mt-1 text-sm leading-6 text-emerald-950/80">
                Customer messages can now be received and answered through this connection.
              </p>
            ) : null}
          </div>
          {stage === "done" ? <Badge className="w-fit rounded-md bg-emerald-600 text-white">Healthy</Badge> : null}
        </div>
        {stage === "done" ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-emerald-200">
              <dt className="text-xs font-medium text-muted-foreground">Phone</dt>
              <dd className="mt-1 font-semibold text-foreground">{connectionSummary.maskedPhoneNumber ?? "Selected number"}</dd>
            </div>
            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-emerald-200">
              <dt className="text-xs font-medium text-muted-foreground">Business name</dt>
              <dd className="mt-1 font-semibold text-foreground">{connectionSummary.verifiedName ?? "Not available"}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <ol className="space-y-2" aria-live="polite" aria-label="Connection activation progress">
        {CONNECTION_PROGRESS_ITEMS.map((item, index) => {
          const done = index < completeCount;
          const failed = stage === "error" && index === completeCount;
          const active = !done && ((stage === "configuring" && index === 2) || (stage === "finalizing" && index === 3));

          return (
            <li
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-sm",
                done && "border-emerald-200 bg-emerald-50 text-emerald-950",
                active && "border-emerald-300 bg-white text-foreground",
                failed && "border-destructive/25 bg-destructive/10 text-foreground",
                !done && !active && !failed && "border-border bg-background text-muted-foreground",
              )}
              key={item}
            >
              {active ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin text-emerald-700 motion-reduce:animate-none" />
              ) : done ? (
                <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
              ) : failed ? (
                <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
              ) : (
                <Circle aria-hidden="true" className="size-4 text-muted-foreground" />
              )}
              <span className="flex-1">{item}</span>
              <span className="text-xs font-medium">
                {done ? "Complete" : active ? "Running" : failed ? "Failed" : "Pending"}
              </span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-foreground" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col justify-between gap-2 border-t border-marketing-border pt-4 sm:flex-row">
        {stage !== "done" ? (
          <Button className="min-h-11 w-full sm:w-auto" disabled={isBusy} onClick={onUpdateCredentials} type="button" variant="outline">
            <KeyRound aria-hidden="true" />
            Update Meta credentials
          </Button>
        ) : <span aria-hidden="true" />}
        {stage === "done" ? (
          <Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" onClick={onDone} type="button">
            Done
          </Button>
        ) : (
          <Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" disabled={isBusy} onClick={onRetry} type="button">
            {isBusy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden="true" />}
            {stage === "error" ? "Retry connection" : "Connect WhatsApp"}
          </Button>
        )}
      </div>
    </div>
  );
}
