import { Sparkles } from "lucide-react";

type SectionEyebrowProps = Readonly<{
  children: string;
}>;

export function SectionEyebrow({ children }: SectionEyebrowProps) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-marketing-border bg-marketing-surface px-3 py-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-marketing-primary uppercase shadow-xs sm:text-xs">
      <Sparkles aria-hidden="true" className="size-3.5" />
      {children}
    </p>
  );
}
