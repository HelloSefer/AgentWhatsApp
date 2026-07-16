import { DifferentiationSection } from "@/features/marketing/components/differentiation-section";
import { FaqSection } from "@/features/marketing/components/faq-section";
import { FinalCtaSection } from "@/features/marketing/components/final-cta-section";
import { HeroSection } from "@/features/marketing/components/hero-section";
import { FeaturesSection } from "@/features/marketing/components/features-section";
import { HowItWorksSection } from "@/features/marketing/components/how-it-works-section";
import { PricingSection } from "@/features/marketing/components/pricing-section";
import { ProblemSection } from "@/features/marketing/components/problem-section";
import { SolutionSection } from "@/features/marketing/components/solution-section";

export default function MarketingHomePage() {
  return (
    <>
      <HeroSection />
      <ProblemSection />
      <SolutionSection />
      <FeaturesSection />
      <HowItWorksSection />
      <DifferentiationSection />
      <PricingSection />
      <FaqSection />
      <FinalCtaSection />
    </>
  );
}
