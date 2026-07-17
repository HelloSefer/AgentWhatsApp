import { buttonVariants } from "@/components/ui/button";
import { signOutFromDashboard } from "../actions/auth-actions";

export function SignOutButton() {
  return (
    <form action={signOutFromDashboard}>
      <button className={buttonVariants({ variant: "outline", className: "h-10 px-4" })} type="submit">
        Sign out
      </button>
    </form>
  );
}
