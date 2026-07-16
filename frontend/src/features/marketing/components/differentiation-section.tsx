import { Container } from "@/components/shared/container";
import { landingContent } from "../data/landing-content";
import { MarketingIcon } from "./marketing-icon";
import { SectionHeading } from "./section-heading";

export function DifferentiationSection() {
  const { differentiation } = landingContent;

  return (
    <section
      aria-labelledby={`${differentiation.id}-heading`}
      className="scroll-mt-24 bg-marketing-surface py-16 sm:py-20 lg:py-24"
      id={differentiation.id}
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-start lg:gap-16">
          <SectionHeading {...differentiation} />
          <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4" role="list">
            {differentiation.items.map((item) => (
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
        </div>
      </Container>
    </section>
  );
}
