"use client";

import { buttonVariants } from "@/components/ui/button";
import { useLogoutMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";

export function SignOutButton() {
  const logout = useLogoutMutation();

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        aria-busy={logout.isPending}
        className={buttonVariants({ variant: "outline", className: "h-10 px-4" })}
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        type="button"
      >
        {logout.isPending ? "Signing out..." : "Sign out"}
      </button>
      {logout.isError ? (
        <p className="max-w-56 text-sm leading-5 text-destructive" role="alert">
          {authErrorMessage(logout.error)}
        </p>
      ) : null}
    </div>
  );
}
