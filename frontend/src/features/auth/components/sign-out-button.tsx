"use client";

import { buttonVariants } from "@/components/ui/button";
import { useLogoutMutation } from "../hooks/use-auth-session";

export function SignOutButton() {
  const logout = useLogoutMutation();

  return (
    <button
      aria-busy={logout.isPending}
      className={buttonVariants({ variant: "outline", className: "h-10 px-4" })}
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
      type="button"
    >
      {logout.isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
