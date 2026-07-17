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
    title: "Log in to your account",
    description: "Continue to manage your WhatsApp conversations, orders, and sales workspace.",
    googleActionLabel: "Sign in with Google",
    alternatePrompt: "New to AgentWhatsApp?",
    alternateLinkLabel: "Create an account",
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
import { siteConfig } from "@/config/site";
