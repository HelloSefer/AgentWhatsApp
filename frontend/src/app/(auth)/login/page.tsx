import { AuthScreen } from "@/features/auth/components/auth-screen";

type LoginPageProps = Readonly<{
  searchParams: Promise<{
    error?: string;
  }>;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return <AuthScreen hasSignInError={Boolean(error)} mode="login" />;
}
