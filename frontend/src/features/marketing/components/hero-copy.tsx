import { heroContent } from "../data/hero-content";
import { SectionEyebrow } from "./section-eyebrow";

export function HeroCopy() {
  return (
    <div className="max-w-[43rem]">
      <SectionEyebrow>{heroContent.eyebrow}</SectionEyebrow>
      <h1 className="mt-5 max-w-[42rem] text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.047em] text-balance text-foreground min-[360px]:text-[2.5rem] sm:text-[3.25rem] sm:leading-[1.05] lg:text-[clamp(3.5rem,4.15vw,3.75rem)]">
        {heroContent.title}
      </h1>
      <p className="mt-4 max-w-[39rem] text-[0.9375rem] leading-6 text-pretty text-muted-foreground sm:mt-5 sm:text-lg sm:leading-8">
        {heroContent.description}
      </p>
    </div>
  );
}
