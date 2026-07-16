import { Container } from "@/components/shared/container";
import { pricingContent, pricingPlans } from "../data/pricing-plans";
import { SectionHeading } from "./section-heading";
import { PricingCard } from "./pricing-card";

export function PricingSection() {
  return (
    <section aria-labelledby={`${pricingContent.id}-heading`} className="scroll-mt-24 bg-marketing-canvas py-16 sm:py-20 lg:py-24" id={pricingContent.id}>
      <Container>
        <SectionHeading {...pricingContent} align="center" />
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
          Plan details and prices are provisional and will be updated by the product owner.
        </p>
        <div className="mt-9 grid gap-4 sm:mt-10 lg:grid-cols-3 lg:items-stretch">
          {pricingPlans.map((plan) => (
            <PricingCard key={plan.id} plan={plan} />
          ))}
        </div>
      </Container>
    </section>
  );
}
