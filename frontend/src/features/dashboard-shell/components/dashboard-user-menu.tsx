"use client";

import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuthSession, useLogoutMutation } from "@/features/auth/hooks/use-auth-session";
import { authErrorMessage } from "@/features/auth/utils/auth-error-message";

function userInitial(email: string | undefined): string {
  return email?.trim().charAt(0).toLocaleUpperCase() || "A";
}

export function DashboardUserMenu() {
  const auth = useAuthSession();
  const logout = useLogoutMutation();
  const email = auth.user?.emailNormalized;
  const role = auth.memberships[0]?.role;

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="bg-marketing-subtle" size="lg">
          <AvatarFallback className="bg-marketing-subtle font-semibold text-marketing-primary">
            {userInitial(email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{email ?? "Workspace user"}</p>
          <p className="truncate text-xs font-medium text-muted-foreground">{role ?? "Member"}</p>
        </div>
      </div>
      <Button
        aria-busy={logout.isPending}
        className="min-h-11 w-full justify-start"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        type="button"
        variant="outline"
      >
        <LogOut aria-hidden="true" />
        {logout.isPending ? "Signing out..." : "Sign out"}
      </Button>
      {logout.isError ? (
        <p className="text-xs leading-5 text-destructive" role="alert">
          {authErrorMessage(logout.error)}
        </p>
      ) : null}
    </div>
  );
}
