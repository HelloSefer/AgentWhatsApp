import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PricingPlan } from "../types/marketing.types";
import { MarketingIcon } from "./marketing-icon";

type PricingCardProps = Readonly<{
  plan: PricingPlan;
}>;

export function PricingCard({ plan }: PricingCardProps) {
  return (
    <article
      aria-labelledby={`${plan.id}-plan-title`}
      className={cn(
        "flex h-full flex-col rounded-xl border p-[1.375rem] shadow-[0_12px_24px_-24px_oklch(0.2_0.04_155/0.4)] sm:p-6 lg:p-7",
        plan.featured
          ? "border-marketing-primary bg-marketing-subtle shadow-[0_16px_32px_-26px_oklch(0.2_0.04_155/0.45)]"
          : "border-marketing-border bg-marketing-surface",
      )}
    >
      <div className="min-h-5">
        {plan.badge ? (
          <span className="inline-flex rounded-full bg-marketing-primary px-2.5 py-0.5 text-xs font-semibold text-marketing-primary-foreground">
            {plan.badge}
          </span>
        ) : null}
      </div>
      <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground" id={`${plan.id}-plan-title`}>
        {plan.name}
      </h3>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">{plan.description}</p>
      <p aria-label={`${plan.price} ${plan.currency} per ${plan.billingPeriod}`} className="mt-5 flex items-end gap-1.5 text-foreground">
        <span className="text-[2.5rem] leading-none font-semibold tracking-[-0.05em] sm:text-[2.75rem] lg:text-[3rem]">{plan.price}</span>
        <span className="pb-0.5 text-sm font-semibold">{plan.currency}</span>
        <span className="pb-0.5 text-sm text-muted-foreground">/ {plan.billingPeriod}</span>
      </p>
      <ul className="mt-6 grid gap-2.5 border-t border-marketing-border pt-5 text-sm leading-5 text-muted-foreground" role="list">
        {plan.features.map((feature) => (
          <li className="flex gap-2.5" key={feature}>
            <MarketingIcon className="mt-0.5 size-4 shrink-0 text-marketing-primary" name="check" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        className={buttonVariants({
          variant: plan.featured ? "default" : "outline",
          className: cn(
            "mt-6 h-11 w-full sm:mt-auto",
            plan.featured
              ? "bg-marketing-primary text-marketing-primary-foreground hover:bg-marketing-primary/90"
              : "border-marketing-border bg-marketing-surface text-foreground hover:bg-marketing-subtle",
          ),
        })}
        href={plan.ctaHref}
      >
        {plan.ctaLabel}
      </Link>
    </article>
  );
}
