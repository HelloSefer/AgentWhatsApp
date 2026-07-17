"use client";

import Image from "next/image";
import { useFormStatus } from "react-dom";
import { buttonVariants } from "@/components/ui/button";
import { signInWithGoogle } from "../actions/auth-actions";

type GoogleAuthButtonProps = Readonly<{
  label: string;
}>;

function GoogleAuthSubmitButton({ label }: GoogleAuthButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={buttonVariants({
        variant: "outline",
        className:
          "h-[50px] min-h-11 w-full gap-3 rounded-md border-[#747775] bg-white px-5 text-sm font-medium text-[#1f1f1f] shadow-[0_1px_2px_rgba(60,64,67,0.08)] hover:border-[#5f6368] hover:bg-[#f8fafd] hover:text-[#1f1f1f] active:bg-[#f1f3f4] focus-visible:border-[#1a73e8] focus-visible:ring-3 focus-visible:ring-[#1a73e8]/35 disabled:border-[#747775]/50 disabled:bg-[#f8fafd] disabled:text-[#1f1f1f]/55 disabled:opacity-100",
      })}
      disabled={pending}
      type="submit"
    >
      <Image alt="" aria-hidden="true" height={18} priority src="/brand/google-g.svg" width={18} />
      <span>{pending ? "Connecting to Google…" : label}</span>
    </button>
  );
}

export function GoogleAuthButton({ label }: GoogleAuthButtonProps) {
  return (
    <form action={signInWithGoogle}>
      <GoogleAuthSubmitButton label={label} />
    </form>
  );
}
