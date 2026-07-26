import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { VerifyEmailPanel } from "@/features/auth/components/verify-email-panel";
import { safeTokenFromQuery } from "@/features/auth/utils/token";

type VerifyEmailPageProps = Readonly<{
  searchParams: Promise<{
    token?: string | string[];
  }>;
}>;

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = safeTokenFromQuery(params.token);

  return (
    <AuthPageShell>
      <VerifyEmailPanel token={token} />
    </AuthPageShell>
  );
}
