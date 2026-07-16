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
  conversation: {
    agentName: "AgentWhatsApp",
    workspaceLabel: "AI sales workspace",
    activeLabel: "AI active",
    productLabel: "Running shoes · 199 MAD",
    messages: [
      { sender: "customer", content: "Salam, wach mazal disponible?" },
      {
        sender: "agent",
        content: "Wa 3alaykom salam! Ah, disponible b 199 MAD. Bghiti tcommandi daba wla tchof details?",
      },
      { sender: "customer", content: "Bghit black, size 40." },
      { sender: "agent", content: "Perfect. Ch7al men pièce bghiti?" },
    ],
    collectionLabel: "Collecting order details",
    collectionFields: ["Color", "Size", "Quantity"],
  },
  order: {
    title: "Order draft",
    status: "Collecting details",
    details: [
      { label: "Product", value: "Running shoes" },
      { label: "Color", value: "Black" },
      { label: "Size", value: "40" },
      { label: "Quantity", value: "Waiting" },
    ],
  },
  activity: {
    title: "New order captured",
    description: "Color and size added",
    timestamp: "Just now",
  },
};
