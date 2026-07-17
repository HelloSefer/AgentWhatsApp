import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/shared/container";
import { landingContent } from "../data/landing-content";
import { SectionHeading } from "./section-heading";

export function FinalCtaSection() {
  const { finalCta } = landingContent;

  return (
    <section aria-labelledby={`${finalCta.id}-heading`} className="scroll-mt-24 bg-marketing-primary py-14 text-marketing-accent-foreground sm:py-16 lg:py-20" id={finalCta.id}>
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeading {...finalCta} align="center" tone="inverse" />
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              className={buttonVariants({
                className: "h-11 bg-marketing-accent-foreground px-5 text-marketing-primary hover:bg-marketing-accent-foreground/90",
              })}
              href={finalCta.primaryAction.href}
            >
              {finalCta.primaryAction.label}
            </Link>
            <Link
              className={buttonVariants({
                variant: "outline",
                className:
                  "h-11 border-marketing-accent-foreground/45 bg-marketing-accent-foreground/5 px-5 text-marketing-accent-foreground hover:bg-marketing-accent-foreground/10 hover:text-marketing-accent-foreground",
              })}
              href={finalCta.secondaryAction.href}
            >
              {finalCta.secondaryAction.label}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
