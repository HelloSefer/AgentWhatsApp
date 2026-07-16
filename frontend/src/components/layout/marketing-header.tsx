import Link from "next/link";
import { siteConfig } from "@/config/site";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";
import { MobileMarketingNav } from "./mobile-marketing-nav";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-marketing-border/80 bg-marketing-canvas/90 backdrop-blur-md">
      <Container className="grid h-16 grid-cols-[1fr_auto] items-center gap-5 md:h-[4.5rem]">
        <SiteLogo className="justify-self-start" />
        <div className="hidden items-center justify-self-end gap-1.5 md:flex">
          <Link
            className={buttonVariants({
              variant: "ghost",
              className: "h-10 px-4",
            })}
            href={siteConfig.actions.login.href}
          >
            {siteConfig.actions.login.label}
          </Link>
          <Link
            className={buttonVariants({
              className:
                "h-10 bg-marketing-primary px-4 text-marketing-primary-foreground shadow-sm hover:bg-marketing-primary/90",
            })}
            href={siteConfig.actions.getStarted.href}
          >
            {siteConfig.actions.getStarted.label}
          </Link>
        </div>
        <div className="justify-self-end md:hidden">
          <MobileMarketingNav />
        </div>
      </Container>
    </header>
  );
}
