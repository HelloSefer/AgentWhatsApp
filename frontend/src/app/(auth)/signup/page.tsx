import { AuthScreen } from "@/features/auth/components/auth-screen";

type SignupPageProps = Readonly<{
  searchParams: Promise<{
    error?: string;
  }>;
}>;

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { error } = await searchParams;

  return <AuthScreen hasSignInError={Boolean(error)} mode="signup" />;
}
