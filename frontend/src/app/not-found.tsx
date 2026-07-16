import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-7xl items-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="max-w-md">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 text-muted-foreground">
          The page you are looking for does not exist or may have moved.
        </p>
        <Link
          className={buttonVariants({ className: "mt-6" })}
          href={siteConfig.routes.home}
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
