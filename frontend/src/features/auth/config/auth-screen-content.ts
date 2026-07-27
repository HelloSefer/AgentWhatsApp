import { siteConfig } from "@/config/site";

export type AuthAppearance = "dark" | "light";
export type AuthScreenMode = "login" | "signup";

export type AuthScreenContent = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  googleActionLabel: string;
  alternatePrompt: string;
  alternateLinkLabel: string;
  alternateHref: string;
}>;

export const authScreenContent: Readonly<Record<AuthScreenMode, AuthScreenContent>> = {
  login: {
    eyebrow: "AgentWhatsApp account",
    title: "Welcome back",
    description: "Sign in to your account to continue managing your conversations.",
    googleActionLabel: "Continue with Google",
    alternatePrompt: "Don’t have an account?",
    alternateLinkLabel: "Create one",
    alternateHref: siteConfig.routes.signUp,
  },
  signup: {
    eyebrow: "Get started",
    title: "Create your AgentWhatsApp account",
    description: "Set up your WhatsApp sales workspace and start managing customer conversations in one place.",
    googleActionLabel: "Sign up with Google",
    alternatePrompt: "Already have an account?",
    alternateLinkLabel: "Sign in",
    alternateHref: siteConfig.routes.login,
  },
};
