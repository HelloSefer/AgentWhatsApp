import { marketingSections, siteConfig } from "@/config/site";
import type { MarketingSectionContent, PricingPlan } from "../types/marketing.types";

export const pricingContent: MarketingSectionContent = {
  id: marketingSections.pricing,
  eyebrow: "Simple monthly plans",
  title: "Choose the plan that fits your sales operation.",
  description:
    "Start with the essentials, then move to a plan with more control as your WhatsApp sales workflow grows.",
};

export const pricingPlans: readonly PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 233,
    currency: "MAD",
    billingPeriod: "month",
    description: "For sellers who want the essential WhatsApp sales workflow.",
    features: [
      "Core AI sales conversation",
      "Darija and Arabizi understanding",
      "Product information responses",
      "Structured order collection",
      "Order confirmation and corrections",
      "Basic order summary",
    ],
    ctaLabel: "Get started",
    ctaHref: siteConfig.routes.signUp,
    featured: false,
  },
  {
    id: "business",
    name: "Business",
    price: 303,
    currency: "MAD",
    billingPeriod: "month",
    description: "For active sellers who need more control and a stronger customer flow.",
    features: [
      "Everything in Starter",
      "Configurable first response",
      "Advanced product options",
      "Delivery and payment configuration",
      "Branded order receipt",
      "Enhanced sales settings",
    ],
    ctaLabel: "Choose Business",
    ctaHref: siteConfig.routes.signUp,
    featured: true,
    badge: "Most popular",
  },
  {
    id: "pro",
    name: "Pro",
    price: 470,
    currency: "MAD",
    billingPeriod: "month",
    description: "For growing commerce operations that need a more advanced workflow.",
    features: [
      "Everything in Business",
      "Advanced order-flow configuration",
      "More flexible product requirements",
      "Extended receipt customization",
      "Priority assistance",
      "Advanced confirmation settings",
    ],
    ctaLabel: "Choose Pro",
    ctaHref: siteConfig.routes.signUp,
    featured: false,
  },
];
