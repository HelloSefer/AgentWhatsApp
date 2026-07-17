import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SiteLogo } from "@/components/shared/site-logo";
import { siteConfig } from "@/config/site";

export function AuthBrandHeader() {
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
