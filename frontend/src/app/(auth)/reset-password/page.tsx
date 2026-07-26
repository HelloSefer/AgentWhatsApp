import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { safeTokenFromQuery } from "@/features/auth/utils/token";

type ResetPasswordPageProps = Readonly<{
  searchParams: Promise<{
    token?: string | string[];
  }>;
}>;

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = safeTokenFromQuery(params.token);

  return (
    <AuthPageShell>
      <section aria-labelledby="reset-password-heading" className="w-full max-w-[33.75rem] rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_24px_48px_-36px_oklch(0.2_0.04_155/0.45)] sm:p-8 lg:p-10">
        <p className="text-xs font-semibold tracking-[0.11em] text-marketing-primary uppercase">Password recovery</p>
        <h1 className="mt-4 text-3xl leading-[1.12] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.5rem]" id="reset-password-heading">
          Choose a new password
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Reset links can only be used once and expire after a short time.
        </p>
        <ResetPasswordForm token={token} />
      </section>
    </AuthPageShell>
  );
}
