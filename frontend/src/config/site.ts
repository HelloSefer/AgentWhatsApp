export const marketingSections = {
  problems: "problems",
  product: "product",
  features: "features",
  howItWorks: "how-it-works",
  whyAgentWhatsApp: "why-agentwhatsapp",
  pricing: "pricing",
  faq: "faq",
  getStarted: "get-started",
} as const;

export const siteConfig = {
  name: "AgentWhatsApp",
  description:
    "Turn WhatsApp customer conversations into structured and confirmed e-commerce orders.",
  routes: {
    home: "/",
    login: "/login",
    signUp: "/register",
  },
  actions: {
    login: { label: "Log in", href: "/login" },
    getStarted: { label: "Get started", href: "/register" },
  },
  navigation: [
    { label: "Product", href: `#${marketingSections.product}` },
    { label: "Features", href: `#${marketingSections.features}` },
    { label: "How it works", href: `#${marketingSections.howItWorks}` },
    { label: "Pricing", href: `#${marketingSections.pricing}` },
    { label: "FAQ", href: `#${marketingSections.faq}` },
  ],
} as const;
