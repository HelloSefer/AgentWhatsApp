import { CircleDotDashed, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { heroContent } from "../data/hero-content";

type OrderSummaryCardProps = Readonly<{
  className?: string;
}>;

export function OrderSummaryCard({ className }: OrderSummaryCardProps) {
  const { order } = heroContent;

  return (
    <aside
      aria-label="Sample order draft"
      className={cn(
        "min-w-0 rounded-lg border border-marketing-border bg-marketing-surface p-2.5 shadow-[0_14px_30px_-26px_oklch(0.2_0.04_155/0.44)] sm:rounded-xl sm:p-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
          <ClipboardCheck aria-hidden="true" className="size-4 text-marketing-primary" />
          <span className="truncate">{order.title}</span>
        </p>
        <span className="text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">Demo</span>
      </div>

      <dl className="mt-2.5 grid gap-1.5 sm:mt-3 sm:gap-2">
        {order.details.map((detail) => (
          <div className="flex items-baseline justify-between gap-2 text-[0.6875rem]" key={detail.label}>
            <dt className="text-muted-foreground">{detail.label}</dt>
            <dd className="min-w-0 truncate text-right font-medium text-foreground">{detail.value}</dd>
          </div>
        ))}
      </dl>

      <div aria-hidden="true" className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-marketing-muted sm:mt-3">
        <div className="h-full w-2/3 rounded-full bg-marketing-primary" />
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] font-medium text-marketing-primary sm:mt-2">
        <CircleDotDashed aria-hidden="true" className="size-3.5" />
        {order.status}
      </p>
    </aside>
  );
}
