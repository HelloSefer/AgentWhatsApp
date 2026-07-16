import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { heroContent } from "../data/hero-content";

type OrderActivityCardProps = Readonly<{
  className?: string;
}>;

export function OrderActivityCard({ className }: OrderActivityCardProps) {
  const { activity } = heroContent;

  return (
    <aside
      aria-label="Sample order activity"
      className={cn(
        "min-w-0 rounded-lg border border-marketing-border bg-marketing-surface p-2.5 shadow-[0_14px_30px_-26px_oklch(0.2_0.04_155/0.42)] sm:rounded-xl sm:p-3",
        className,
      )}
    >
      <div className="flex gap-2 sm:gap-2.5">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-marketing-primary" />
        <div className="min-w-0">
          <p className="text-xs leading-4 font-semibold text-foreground">{activity.title}</p>
          <p className="mt-0.5 text-[0.6875rem] leading-4 text-muted-foreground">{activity.description}</p>
          <p className="mt-1 text-[0.6875rem] font-medium text-muted-foreground sm:mt-2">{activity.timestamp}</p>
        </div>
      </div>
    </aside>
  );
}
