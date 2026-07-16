import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type SiteLogoProps = Readonly<{
  className?: string;
}>;

export function SiteLogo({ className }: SiteLogoProps) {
  return (
    <Link
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md font-semibold tracking-[-0.02em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      href={siteConfig.routes.home}
    >
      <span className="flex size-8 items-center justify-center rounded-[0.65rem] bg-marketing-primary text-marketing-primary-foreground shadow-sm">
        <MessagesSquare aria-hidden="true" className="size-[1.05rem]" />
      </span>
      <span>{siteConfig.name}</span>
    </Link>
  );
}
