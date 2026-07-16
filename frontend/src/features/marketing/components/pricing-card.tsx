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
        "flex h-full flex-col rounded-2xl border p-5 shadow-[0_16px_32px_-30px_oklch(0.2_0.04_155/0.45)] sm:p-6",
        plan.featured
          ? "border-marketing-primary bg-marketing-subtle shadow-[0_22px_44px_-30px_oklch(0.2_0.04_155/0.5)]"
          : "border-marketing-border bg-marketing-surface",
      )}
    >
      <div className="min-h-6">
        {plan.badge ? (
          <span className="inline-flex rounded-full bg-marketing-primary px-2.5 py-1 text-xs font-semibold text-marketing-primary-foreground">
            {plan.badge}
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-xl font-semibold tracking-[-0.025em] text-foreground" id={`${plan.id}-plan-title`}>
        {plan.name}
      </h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.description}</p>
      <p aria-label={`${plan.price} ${plan.currency} per ${plan.billingPeriod}`} className="mt-6 flex items-end gap-2 text-foreground">
        <span className="text-4xl leading-none font-semibold tracking-[-0.05em]">{plan.price}</span>
        <span className="pb-0.5 text-sm font-semibold">{plan.currency}</span>
        <span className="pb-0.5 text-sm text-muted-foreground">/ {plan.billingPeriod}</span>
      </p>
      <ul className="mt-7 grid gap-3 border-t border-marketing-border pt-6 text-sm leading-5 text-muted-foreground" role="list">
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
            "mt-8 h-11 w-full",
            plan.featured && "bg-marketing-primary text-marketing-primary-foreground hover:bg-marketing-primary/90",
          ),
        })}
        href={plan.ctaHref}
      >
        {plan.ctaLabel}
      </Link>
    </article>
  );
}
