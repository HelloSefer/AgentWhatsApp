import { Container } from "@/components/shared/container";
import { landingContent } from "../data/landing-content";
import { MarketingIcon } from "./marketing-icon";
import { SectionHeading } from "./section-heading";

export function ProblemSection() {
  const { problem } = landingContent;

  return (
    <section aria-labelledby={`${problem.id}-heading`} className="scroll-mt-24 bg-marketing-surface py-16 sm:py-20 lg:py-24" id={problem.id}>
      <Container>
        <SectionHeading {...problem} />
        <ul className="mt-9 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3" role="list">
          {problem.items.map((item) => (
            <li key={item.title}>
              <article className="h-full rounded-2xl border border-marketing-border bg-marketing-canvas p-5 sm:p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-marketing-subtle text-marketing-primary">
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
