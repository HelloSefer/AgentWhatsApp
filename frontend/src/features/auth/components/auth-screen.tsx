import { authScreenContent, type AuthScreenMode } from "../config/auth-screen-content";
import { AuthPageShell } from "./auth-page-shell";
import { AuthPanel } from "./auth-panel";
import { AuthValuePanel } from "./auth-value-panel";

type AuthScreenProps = Readonly<{
  mode: AuthScreenMode;
  hasSignInError: boolean;
}>;

export function AuthScreen({ mode, hasSignInError }: AuthScreenProps) {
  const content = authScreenContent[mode];

  if (mode === "login") {
    return (
      <AuthPageShell appearance="dark" aside={<AuthValuePanel appearance="dark" />}>
        <AuthPanel appearance="dark" content={content} hasSignInError={hasSignInError} mode={mode} />
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <AuthPanel content={content} hasSignInError={hasSignInError} mode={mode} />
    </AuthPageShell>
  );
}
