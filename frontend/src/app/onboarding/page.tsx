import type { Metadata } from "next";
import { OnboardingPageShell } from "@/features/onboarding/components/onboarding-page-shell";

export const metadata: Metadata = {
  title: "Set up workspace",
  description: "Create your AgentWhatsApp seller workspace.",
};

export default function OnboardingPage() {
  return <OnboardingPageShell />;
}
