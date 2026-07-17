import type { ReactNode } from "react";
import { Container } from "@/components/shared/container";
import { AuthAgentStage } from "./auth-agent-stage";
import { AuthBrandHeader } from "./auth-brand-header";

type AuthPageShellProps = Readonly<{
  children: ReactNode;
}>;

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <main className="min-h-screen bg-marketing-canvas">
      <Container className="flex min-h-screen max-w-[75rem] flex-col px-5 sm:px-6 lg:px-8">
        <AuthBrandHeader />
        <div className="grid flex-1 content-center items-center gap-7 pb-8 sm:pb-12 md:gap-8 lg:grid-cols-[minmax(0,0.46fr)_minmax(0,0.54fr)] lg:gap-5 lg:pb-16 xl:gap-7">
          <div className="flex w-full justify-center lg:justify-start">{children}</div>
          <AuthAgentStage />
        </div>
      </Container>
    </main>
  );
}
