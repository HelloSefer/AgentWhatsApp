import { Clock3 } from "lucide-react";

export function DashboardActivityEmptyState() {
  return (
    <section
      aria-labelledby="recent-activity-heading"
      className="rounded-xl border border-marketing-border bg-white p-3 shadow-[0_14px_30px_-30px_oklch(0.2_0.04_155/0.35)] sm:p-4"
    >
      <div className="flex gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-marketing-subtle text-marketing-primary ring-1 ring-marketing-border">
          <Clock3 aria-hidden="true" className="size-3.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground" id="recent-activity-heading">
            Recent activity
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Activity will appear here after your WhatsApp connection and commerce setup are active.
          </p>
        </div>
      </div>
    </section>
  );
}
