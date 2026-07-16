import { ChevronDown } from "lucide-react";
import { Container } from "@/components/shared/container";
import { faqContent, faqItems } from "../data/faq-content";
import { SectionHeading } from "./section-heading";

export function FaqSection() {
  return (
    <section aria-labelledby={`${faqContent.id}-heading`} className="scroll-mt-24 bg-marketing-surface py-16 sm:py-20 lg:py-24" id={faqContent.id}>
      <Container>
        <SectionHeading {...faqContent} align="center" />
        <div className="mx-auto mt-9 grid max-w-3xl gap-3 sm:mt-10">
          {faqItems.map((item) => (
            <details className="group rounded-2xl border border-marketing-border bg-marketing-canvas" key={item.question}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6 sm:text-base [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span>
                <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-marketing-primary" />
              </summary>
              <p className="border-t border-marketing-border px-5 py-4 text-sm leading-6 text-muted-foreground sm:px-6">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
