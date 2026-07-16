import { Cloud, Languages, PackageCheck } from "lucide-react";
import type { TrustIndicatorIconName } from "../types/marketing.types";
import { heroContent } from "../data/hero-content";

const trustIcons: Readonly<Record<TrustIndicatorIconName, typeof Languages>> = {
  cloud: Cloud,
  commerce: PackageCheck,
  language: Languages,
};

export function HeroTrustIndicators() {
  return (
    <ul
      aria-label="Product capabilities"
      className="mt-5 grid max-w-[42rem] gap-x-4 gap-y-2 border-t border-marketing-border pt-4 text-[0.8125rem] leading-5 text-muted-foreground sm:mt-6 sm:gap-x-5 sm:gap-y-3 sm:pt-5 sm:grid-cols-3"
    >
      {heroContent.trustIndicators.map((indicator) => {
        const Icon = trustIcons[indicator.icon];

        return (
          <li className="flex min-w-0 items-start gap-2" key={indicator.label}>
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-marketing-subtle">
              <Icon aria-hidden="true" className="size-3.5 text-marketing-primary" />
            </span>
            <span className="min-w-0">{indicator.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
