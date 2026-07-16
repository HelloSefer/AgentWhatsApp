import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";
import { siteConfig } from "@/config/site";

type AuthRoutePlaceholderProps = Readonly<{
  title: string;
  description: string;
}>;

export function AuthRoutePlaceholder({ title, description }: AuthRoutePlaceholderProps) {
  return (
    <main className="min-h-screen bg-marketing-canvas py-6 sm:py-8">
      <Container className="mx-auto max-w-3xl">
        <SiteLogo />
        <section className="mt-16 rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-sm sm:mt-24 sm:p-10">
          <p className="text-xs font-semibold tracking-[0.08em] text-marketing-primary uppercase">
            AgentWhatsApp account
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-xl leading-7 text-muted-foreground">{description}</p>
          <Link
            className={buttonVariants({
              className:
                "mt-8 h-11 bg-marketing-primary px-4 text-marketing-primary-foreground hover:bg-marketing-primary/90",
            })}
            href={siteConfig.routes.home}
          >
            <ArrowLeft aria-hidden="true" />
            Back to home
          </Link>
        </section>
      </Container>
    </main>
  );
}
