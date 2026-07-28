import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OperationalStatusCardModel, OverviewStatusTone } from "./dashboard-overview.types";

const toneClassName: Record<OverviewStatusTone, string> = {
  success: "border-marketing-primary/25 bg-marketing-subtle text-marketing-primary",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  muted: "border-border bg-background text-muted-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

type OperationalStatusCardProps = Readonly<{
  card: OperationalStatusCardModel;
}>;

export function OperationalStatusCard({ card }: OperationalStatusCardProps) {
  const Icon = card.icon;

  return (
    <article className="rounded-xl border border-marketing-border bg-white p-4 shadow-[0_14px_30px_-30px_oklch(0.2_0.04_155/0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-marketing-subtle text-marketing-primary ring-1 ring-marketing-border">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <h3 className="text-base font-semibold leading-snug text-foreground">{card.title}</h3>
        </div>
        <Badge className={cn("h-6 rounded-md px-2 font-semibold", toneClassName[card.tone])} variant="outline">
          {card.statusLabel}
        </Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.description}</p>
      {card.details?.length ? (
        <dl className="mt-3 grid gap-2 text-sm">
          {card.details.map((detail) => (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-marketing-border bg-marketing-canvas px-3 py-2" key={detail.label}>
              <dt className="text-muted-foreground">{detail.label}</dt>
              <dd className="min-w-0 truncate font-semibold text-foreground">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.action?.href ? (
        <Link className={cn(buttonVariants({ variant: "outline", className: "mt-4 min-h-11 w-full justify-between" }))} href={card.action.href}>
          {card.action.label}
          <ArrowRight aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}
