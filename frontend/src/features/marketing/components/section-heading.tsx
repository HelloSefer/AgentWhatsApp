import { cn } from "@/lib/utils";

type SectionHeadingProps = Readonly<{
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  align?: "left" | "center";
  tone?: "default" | "inverse";
}>;

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  tone = "default",
}: SectionHeadingProps) {
  const isInverse = tone === "inverse";

  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      <p
        className={cn(
          "text-xs font-semibold tracking-[0.12em] uppercase",
          isInverse ? "text-marketing-accent-foreground/70" : "text-marketing-primary",
        )}
      >
        {eyebrow}
      </p>
      <h2
        id={`${id}-heading`}
        className={cn(
          "mt-3 text-[2rem] leading-[1.12] font-semibold tracking-[-0.035em] text-balance sm:text-[2.5rem] lg:text-[2.75rem]",
          isInverse ? "text-marketing-accent-foreground" : "text-foreground",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "mt-4 text-[0.9375rem] leading-6 sm:text-base sm:leading-7",
          isInverse ? "text-marketing-accent-foreground/75" : "text-muted-foreground",
        )}
      >
        {description}
      </p>
    </div>
  );
}
