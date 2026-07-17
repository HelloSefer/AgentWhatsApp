import { auth } from "@/auth";
import { DashboardEntry } from "@/features/auth/components/dashboard-entry";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <DashboardEntry user={session.user} />;
}
