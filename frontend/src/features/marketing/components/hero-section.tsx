import { Container } from "@/components/shared/container";
import { AgentShowcase } from "@/features/agent-showcase/components/agent-showcase";
import { HeroActions } from "./hero-actions";
import { HeroCopy } from "./hero-copy";
import { HeroTrustIndicators } from "./hero-trust-indicators";

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden bg-marketing-canvas py-7 sm:py-14 lg:py-16 xl:py-20">
      <div
        aria-hidden="true"
        className="absolute top-20 right-[-7rem] -z-10 size-72 rounded-full bg-marketing-muted/25 blur-3xl"
      />
      <Container className="relative">
        <div className="grid items-center gap-9 sm:gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(29rem,0.92fr)] lg:gap-12 xl:grid-cols-[minmax(0,0.88fr)_minmax(37rem,1.12fr)] xl:gap-12">
          <div className="min-w-0 lg:py-2">
            <HeroCopy />
            <HeroActions />
            <HeroTrustIndicators />
          </div>
          <AgentShowcase id="conversation-demo" />
        </div>
      </Container>
    </section>
  );
}
