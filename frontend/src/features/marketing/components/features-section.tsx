import { Container } from "@/components/shared/container";
import { cn } from "@/lib/utils";
import { landingContent } from "../data/landing-content";
import { MarketingIcon } from "./marketing-icon";
import { SectionHeading } from "./section-heading";

export function FeaturesSection() {
  const { features } = landingContent;

  return (
    <section aria-labelledby={`${features.id}-heading`} className="scroll-mt-24 bg-marketing-canvas py-16 sm:py-20 lg:py-24" id={features.id}>
      <Container>
        <SectionHeading {...features} align="center" />
        <ul className="mt-9 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3" role="list">
          {features.items.map((item, index) => (
            <li key={item.title}>
              <article
                className={cn(
                  "h-full rounded-2xl border border-marketing-border p-5 shadow-[0_16px_32px_-30px_oklch(0.2_0.04_155/0.45)] sm:p-6",
                  index < 2 ? "bg-marketing-subtle" : "bg-marketing-surface",
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-xl border border-marketing-border bg-marketing-surface text-marketing-primary">
                  <MarketingIcon className="size-[1.125rem]" name={item.icon} />
                </span>
                <h3 className="mt-5 text-base font-semibold tracking-[-0.015em] text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </article>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
