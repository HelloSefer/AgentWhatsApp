import Link from "next/link";
import { AlertCircle, CheckCircle2, Circle, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardOverviewViewModel, LaunchStage } from "./dashboard-overview.types";

const stageCopy: Record<LaunchStage["state"], { label: string; className: string }> = {
  completed: { label: "Complete", className: "border-marketing-primary/25 bg-marketing-subtle text-marketing-primary" },
  current: { label: "Current", className: "border-marketing-primary/25 bg-white text-marketing-primary" },
  upcoming: { label: "Upcoming", className: "border-border bg-background text-muted-foreground" },
  soon: { label: "Soon", className: "border-border bg-background text-muted-foreground" },
  action_required: { label: "Action required", className: "border-destructive/25 bg-destructive/10 text-destructive" },
};

function StageIcon({ stage }: Readonly<{ stage: LaunchStage }>) {
  if (stage.state === "completed") return <CheckCircle2 aria-hidden="true" className="size-5 text-marketing-primary" />;
  if (stage.state === "action_required") return <AlertCircle aria-hidden="true" className="size-5 text-destructive" />;
  if (stage.state === "soon") return <Clock3 aria-hidden="true" className="size-5 text-muted-foreground" />;
  return <Circle aria-hidden="true" className="size-5 text-muted-foreground" />;
}

type LaunchProgressCardProps = Readonly<{
  overview: DashboardOverviewViewModel;
}>;

export function LaunchProgressCard({ overview }: LaunchProgressCardProps) {
  const progressPercent = Math.round((overview.completedStages / overview.totalStages) * 100);

  return (
    <section
      aria-describedby="launch-progress-description"
      aria-labelledby="launch-progress-heading"
      className="rounded-xl border border-marketing-border bg-white p-5 shadow-[0_18px_36px_-32px_oklch(0.2_0.04_155/0.35)] sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Launch progress</p>
          <h3 className="mt-2 text-xl font-semibold text-foreground" id="launch-progress-heading">
            {overview.completedStages} of {overview.totalStages} completed
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground" id="launch-progress-description">
            Progress is based only on setup states currently available to the dashboard.
          </p>
        </div>
        {overview.primaryAction?.href ? (
          <Link className={cn(buttonVariants({ className: "min-h-11 w-full sm:w-auto" }))} href={overview.primaryAction.href}>
            {overview.primaryAction.label}
          </Link>
        ) : null}
      </div>

      <div className="mt-5" role="img" aria-label={`${overview.completedStages} of ${overview.totalStages} launch stages completed`}>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-marketing-primary" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <ol className="mt-5 grid gap-3 md:grid-cols-2">
        {overview.stages.map((stage) => {
          const copy = stageCopy[stage.state];

          return (
            <li className="flex gap-3 rounded-lg border border-marketing-border bg-marketing-canvas p-3" key={stage.label}>
              <StageIcon stage={stage} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-foreground">{stage.label}</p>
                  <Badge className={cn("h-5 rounded-md px-1.5 text-[0.68rem] font-semibold", copy.className)} variant="outline">
                    {copy.label}
                  </Badge>
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{stage.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
