"use client";

import Image from "next/image";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AuthAppearance } from "../config/auth-screen-content";
import { authEndpoints } from "../services/auth-service";

type GoogleAuthButtonProps = Readonly<{
  appearance?: AuthAppearance;
  label: string;
}>;

export function GoogleAuthButton({ appearance = "light", label }: GoogleAuthButtonProps) {
  const [pending, setPending] = useState(false);
  const isDark = appearance === "dark";

  function startGoogleAuth() {
    setPending(true);
    window.location.assign(authEndpoints.googleStart());
  }

  return (
    <button
      aria-busy={pending}
      className={buttonVariants({
        variant: "outline",
        className: isDark
          ? cn(
              "h-[clamp(3rem,6vh,3.5rem)] min-h-11 w-full cursor-pointer gap-3 rounded-xl border-white bg-white px-5 text-sm font-medium text-[#1f1f1f] shadow-[0_8px_24px_-14px_rgba(0,0,0,0.55)] transition-[background-color,transform,box-shadow,border-color] duration-200 motion-reduce:transform-none motion-reduce:transition-none hover:bg-[#f8fafd] hover:text-[#1f1f1f] hover:shadow-[0_12px_30px_-14px_rgba(0,0,0,0.7)] active:translate-y-px active:bg-[#f1f3f4] focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-[#1a73e8]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d] disabled:cursor-not-allowed disabled:border-white disabled:bg-[#f8fafd] disabled:text-[#1f1f1f] disabled:opacity-100",
            )
          : "h-[50px] min-h-11 w-full gap-3 rounded-md border-[#747775] bg-white px-5 text-sm font-medium text-[#1f1f1f] shadow-[0_1px_2px_rgba(60,64,67,0.08)] hover:border-[#5f6368] hover:bg-[#f8fafd] hover:text-[#1f1f1f] active:bg-[#f1f3f4] focus-visible:border-[#1a73e8] focus-visible:ring-3 focus-visible:ring-[#1a73e8]/35 disabled:border-[#747775]/50 disabled:bg-[#f8fafd] disabled:text-[#1f1f1f]/55 disabled:opacity-100",
      })}
      disabled={pending}
      onClick={startGoogleAuth}
      suppressHydrationWarning={isDark}
      type="button"
    >
      <Image alt="" aria-hidden="true" height={18} priority src="/brand/google-g.svg" width={18} />
      <span>{pending ? "Connecting to Google…" : label}</span>
    </button>
  );
}
