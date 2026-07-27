import type { ReactNode } from "react";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";
import { DashboardAuthGuard } from "@/features/auth/components/dashboard-auth-guard";

type DashboardLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <main className="min-h-screen bg-marketing-canvas py-6 sm:py-10">
      <Container className="mx-auto max-w-6xl">
        <SiteLogo />
        <div className="mt-12 sm:mt-16">
          <DashboardAuthGuard>{children}</DashboardAuthGuard>
        </div>
      </Container>
    </main>
  );
}
