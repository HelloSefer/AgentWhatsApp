"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

type ErrorPageProps = Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>;

export default function ErrorPage({ error, unstable_retry }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-7xl items-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="max-w-md">
        <p className="text-sm font-medium text-muted-foreground">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          We could not load this page.
        </h1>
        <p className="mt-3 text-muted-foreground">Please try again in a moment.</p>
        <Button className="mt-6" onClick={unstable_retry}>
          Try again
        </Button>
      </div>
    </main>
  );
}
