import type { Metadata } from "next";
import { AuthScreen } from "@/features/auth/components/auth-screen";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in securely to your AgentWhatsApp workspace.",
};

type LoginPageProps = Readonly<{
  searchParams: Promise<{
    error?: string;
  }>;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return <AuthScreen hasSignInError={Boolean(error)} mode="login" />;
}
