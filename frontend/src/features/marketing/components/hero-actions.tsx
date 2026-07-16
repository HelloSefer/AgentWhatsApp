import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { heroContent } from "../data/hero-content";

export function HeroActions() {
  return (
    <div className="mt-6 flex flex-col gap-2.5 sm:mt-7 sm:gap-3 sm:flex-row sm:items-center">
      <Link
        className={buttonVariants({
          className:
            "h-12 w-full bg-marketing-primary px-5 text-[0.9375rem] text-marketing-primary-foreground shadow-[0_10px_24px_-14px_oklch(0.25_0.1_155/0.7)] hover:bg-marketing-primary/90 sm:w-auto",
        })}
        href={heroContent.primaryAction.href}
      >
        {heroContent.primaryAction.label}
        <ArrowRight aria-hidden="true" />
      </Link>
      <Link
        className={buttonVariants({
          variant: "outline",
          className:
            "h-12 w-full border-marketing-border bg-marketing-surface px-5 text-[0.9375rem] shadow-xs hover:bg-marketing-subtle sm:w-auto",
        })}
        href={heroContent.secondaryAction.href}
      >
        <PlayCircle aria-hidden="true" />
        {heroContent.secondaryAction.label}
      </Link>
    </div>
  );
}
