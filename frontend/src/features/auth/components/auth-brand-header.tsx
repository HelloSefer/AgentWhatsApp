import Link from "next/link";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SiteLogo } from "@/components/shared/site-logo";
import { siteConfig } from "@/config/site";
import type { AuthAppearance } from "../config/auth-screen-content";

type AuthBrandHeaderProps = Readonly<{
  appearance?: AuthAppearance;
}>;

export function AuthBrandHeader({ appearance = "light" }: AuthBrandHeaderProps) {
  const isDark = appearance === "dark";

  if (!isDark) {
    return (
      <header className="flex items-center justify-between gap-4 py-6 sm:py-8">
        <SiteLogo />
        <Link
          className={buttonVariants({
            variant: "ghost",
            className: "h-10 px-2.5 text-muted-foreground hover:bg-marketing-surface hover:text-foreground",
          })}
          href={siteConfig.routes.home}
        >
          <ArrowLeft aria-hidden="true" />
          Back to home
        </Link>
      </header>
    );
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-4">
      <Link
        className="group inline-flex cursor-pointer items-center gap-2.5 rounded-lg text-[clamp(1.35rem,2.85vh,1.65rem)] font-semibold tracking-[-0.04em] text-white transition-colors duration-200 motion-reduce:transition-none hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20d875] focus-visible:ring-offset-4 focus-visible:ring-offset-[#02090d]"
        href={siteConfig.routes.home}
      >
        <span className="flex size-[clamp(2.15rem,4.25vh,2.5rem)] items-center justify-center rounded-full border-2 border-[#25df7d] bg-[#07150f] text-[#25df7d] shadow-[0_0_22px_rgba(37,223,125,0.18)] transition-[transform,box-shadow] duration-200 motion-reduce:transform-none motion-reduce:transition-none group-hover:scale-[1.03] group-hover:shadow-[0_0_26px_rgba(37,223,125,0.28)] group-active:scale-95">
          <MessagesSquare aria-hidden="true" className="size-[clamp(1.05rem,2.15vh,1.25rem)]" strokeWidth={2.1} />
        </span>
        <span>
          Agent<span className="text-[#25df7d]">WhatsApp</span>
        </span>
      </Link>
    </header>
  );
}
