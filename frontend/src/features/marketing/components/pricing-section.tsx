import { Container } from "@/components/shared/container";
import { pricingContent, pricingPlans } from "../data/pricing-plans";
import { SectionHeading } from "./section-heading";
import { PricingCard } from "./pricing-card";

export function PricingSection() {
  return (
    <section aria-labelledby={`${pricingContent.id}-heading`} className="scroll-mt-24 bg-marketing-canvas py-14 sm:py-16 lg:py-20" id={pricingContent.id}>
      <Container>
        <SectionHeading {...pricingContent} align="center" />
        <div className="mt-8 grid gap-3 sm:mt-9 sm:gap-4 lg:grid-cols-3 lg:items-stretch">
          {pricingPlans.map((plan) => (
            <PricingCard key={plan.id} plan={plan} />
          ))}
        </div>
      </Container>
    </section>
  );
}
