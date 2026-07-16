import { Container } from "@/components/shared/container";
import { landingContent } from "../data/landing-content";
import { MarketingIcon } from "./marketing-icon";
import { SectionHeading } from "./section-heading";

export function HowItWorksSection() {
  const { howItWorks } = landingContent;

  return (
    <section aria-labelledby={`${howItWorks.id}-heading`} className="scroll-mt-24 bg-marketing-surface py-16 sm:py-20 lg:py-24" id={howItWorks.id}>
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-end lg:gap-16">
          <SectionHeading {...howItWorks} />
          <ol className="grid gap-3 sm:grid-cols-3 sm:gap-4" aria-label="Getting started steps">
            {howItWorks.steps.map((step) => (
              <li className="h-full" key={step.number}>
                <article className="relative h-full overflow-hidden rounded-2xl border border-marketing-border bg-marketing-canvas p-5 sm:p-6">
                  <p aria-hidden="true" className="text-4xl leading-none font-semibold tracking-[-0.06em] text-marketing-muted">
                    {step.number}
                  </p>
                  <span className="mt-6 flex size-9 items-center justify-center rounded-lg bg-marketing-subtle text-marketing-primary">
                    <MarketingIcon className="size-[1.0625rem]" name={step.icon} />
                  </span>
                  <h3 className="mt-4 text-base font-semibold tracking-[-0.015em] text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </article>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
