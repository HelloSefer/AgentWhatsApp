import type { ReactNode } from "react";
import { auth } from "@/auth";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";
import { redirect } from "next/navigation";

type DashboardLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-marketing-canvas py-6 sm:py-10">
      <Container className="mx-auto max-w-4xl">
        <SiteLogo />
        <div className="mt-12 sm:mt-16">{children}</div>
      </Container>
    </main>
  );
}
