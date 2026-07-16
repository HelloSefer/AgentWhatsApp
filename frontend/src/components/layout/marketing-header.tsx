import Link from "next/link";
import { siteConfig } from "@/config/site";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";
import { MobileMarketingNav } from "./mobile-marketing-nav";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-marketing-border/80 bg-marketing-canvas/90 backdrop-blur-md">
      <Container className="grid h-16 grid-cols-[1fr_auto] items-center gap-5 md:h-[4.5rem] md:grid-cols-[1fr_auto_1fr]">
        <SiteLogo className="justify-self-start" />
        <nav aria-label="Primary navigation" className="hidden items-center gap-7 md:flex">
          {siteConfig.navigation.map((item) => (
            <Link
              className="rounded-md px-1 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-marketing-canvas"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
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
