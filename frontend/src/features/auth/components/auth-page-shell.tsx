import type { ReactNode } from "react";
import { Container } from "@/components/shared/container";
import { AuthBrandHeader } from "./auth-brand-header";
import { AuthValuePanel } from "./auth-value-panel";

type AuthPageShellProps = Readonly<{
  children: ReactNode;
}>;

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <main className="min-h-screen bg-marketing-canvas">
      <Container className="flex min-h-screen max-w-6xl flex-col px-5 sm:px-6 lg:px-8">
        <AuthBrandHeader />
        <div className="grid flex-1 items-center gap-8 pb-8 sm:pb-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10 lg:pb-16 xl:gap-12">
          <div className="flex w-full justify-center lg:justify-start">{children}</div>
          <AuthValuePanel />
        </div>
      </Container>
    </main>
  );
}
