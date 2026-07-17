import type { ReactNode } from "react";
import { Container } from "@/components/shared/container";
import { AuthBrandHeader } from "./auth-brand-header";

type AuthPageShellProps = Readonly<{
  children: ReactNode;
}>;

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <main className="min-h-screen bg-marketing-canvas">
      <Container className="flex min-h-screen max-w-[75rem] flex-col px-5 sm:px-6 lg:px-8">
        <AuthBrandHeader />
        <div className="flex flex-1 items-center justify-center pb-8 sm:pb-12 lg:pb-16">{children}</div>
      </Container>
    </main>
  );
}
