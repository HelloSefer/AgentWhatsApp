import type { HeroContent } from "../types/marketing.types";
import { siteConfig } from "@/config/site";

export const heroContent: HeroContent = {
  eyebrow: "AI sales agent for e-commerce",
  title: "Turn WhatsApp conversations into confirmed orders.",
  description:
    "AgentWhatsApp answers product questions, understands Darija and Arabizi, collects order details, and guides customers toward confirmation—without repetitive manual replies.",
  primaryAction: siteConfig.actions.getStarted,
  secondaryAction: {
    label: "See how it works",
    href: "#conversation-demo",
  },
  trustIndicators: [
    { label: "Understands Darija & Arabizi", icon: "language" },
    { label: "Built for COD commerce", icon: "commerce" },
    { label: "Powered by the official WhatsApp Cloud API", icon: "cloud" },
  ],
};
