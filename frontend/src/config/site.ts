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
} as const;
