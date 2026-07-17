import { authScreenContent, type AuthScreenMode } from "../config/auth-screen-content";
import { AuthPageShell } from "./auth-page-shell";
import { AuthPanel } from "./auth-panel";

type AuthScreenProps = Readonly<{
  mode: AuthScreenMode;
  hasSignInError: boolean;
}>;

export function AuthScreen({ mode, hasSignInError }: AuthScreenProps) {
  const content = authScreenContent[mode];

  return (
    <AuthPageShell>
      <AuthPanel content={content} hasSignInError={hasSignInError} mode={mode} />
    </AuthPageShell>
  );
}
