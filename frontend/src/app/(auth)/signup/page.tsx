import { auth } from "@/auth";
import { AuthScreen } from "@/features/auth/components/auth-screen";
import { redirect } from "next/navigation";

type SignupPageProps = Readonly<{
  searchParams: Promise<{
    error?: string;
  }>;
}>;

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;

  return <AuthScreen hasSignInError={Boolean(error)} mode="signup" />;
}
