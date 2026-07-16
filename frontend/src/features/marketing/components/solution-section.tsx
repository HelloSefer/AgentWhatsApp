import { Container } from "@/components/shared/container";
import { landingContent } from "../data/landing-content";
import { MarketingIcon } from "./marketing-icon";
import { SectionHeading } from "./section-heading";

export function SolutionSection() {
  const { solution } = landingContent;

  return (
    <section aria-labelledby={`${solution.id}-heading`} className="scroll-mt-24 bg-marketing-primary py-16 text-marketing-accent-foreground sm:py-20 lg:py-24" id={solution.id}>
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-end lg:gap-16">
          <div>
            <SectionHeading {...solution} tone="inverse" />
            <p className="mt-6 max-w-lg text-sm leading-6 font-medium text-marketing-accent-foreground sm:text-base sm:leading-7">
              {solution.statement}
            </p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-2" aria-label="AgentWhatsApp sales workflow">
            {solution.stages.map((stage) => (
              <li className="h-full" key={stage.number}>
                <article className="flex h-full gap-3 rounded-2xl border border-marketing-accent-foreground/15 bg-marketing-accent-foreground/8 p-4 sm:flex-col sm:gap-4 sm:p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-marketing-accent-foreground text-[0.6875rem] font-bold tracking-[0.08em] text-marketing-primary">
                    {stage.number}
                  </span>
                  <div>
                    <MarketingIcon className="mb-3 hidden size-[1.125rem] text-marketing-accent-foreground/70 sm:block" name={stage.icon} />
                    <h3 className="text-sm font-semibold text-marketing-accent-foreground">{stage.title}</h3>
                    <p className="mt-1.5 text-[0.8125rem] leading-5 text-marketing-accent-foreground/72">{stage.description}</p>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
