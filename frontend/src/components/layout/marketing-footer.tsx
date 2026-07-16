import Link from "next/link";
import { siteConfig } from "@/config/site";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";

export function MarketingFooter() {
  return (
    <footer className="border-t border-marketing-border bg-marketing-surface">
      <Container className="flex flex-col gap-5 py-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <SiteLogo className="text-sm" />
          <p className="max-w-xs text-xs leading-5">Structured conversations. Confirmed commerce orders.</p>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {siteConfig.navigation.map((item) => (
            <Link className="hover:text-foreground" href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs">© {new Date().getFullYear()} {siteConfig.name}</p>
      </Container>
    </footer>
  );
}
