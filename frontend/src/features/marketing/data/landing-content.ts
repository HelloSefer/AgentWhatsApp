import { marketingSections } from "@/config/site";
import type { LandingContent } from "../types/marketing.types";

export const landingContent: LandingContent = {
  problem: {
    id: marketingSections.problems,
    eyebrow: "The manual sales problem",
    title: "WhatsApp brings the customers. Manual follow-up slows the order down.",
    description:
      "Repeated questions, delayed replies, and incomplete order details make it harder to turn interest into confirmed purchases.",
    items: [
      {
        title: "Repetitive product questions",
        description:
          "Sellers spend time answering the same questions about price, availability, delivery, sizes, and colors.",
        icon: "message",
      },
      {
        title: "Slow or missed replies",
        description:
          "Customers can leave when responses take too long or messages are overlooked during busy periods.",
        icon: "timer",
      },
      {
        title: "Scattered order details",
        description:
          "Names, phone numbers, addresses, variants, and quantities are collected across messages and can become incomplete.",
        icon: "list",
      },
    ],
  },
  solution: {
    id: marketingSections.product,
    eyebrow: "One connected sales workflow",
    title: "From the first message to a structured order.",
    description:
      "AgentWhatsApp keeps the conversation moving, captures the right information, and guides customers toward a clear confirmation step.",
    statement: "One conversation. One guided flow. One structured order.",
    stages: [
      {
        number: "01",
        title: "Understand",
        description: "Understands customer intent, Darija, Arabizi, and common product questions.",
        icon: "brain",
      },
      {
        number: "02",
        title: "Answer",
        description: "Provides product, price, availability, delivery, and payment information.",
        icon: "reply",
      },
      {
        number: "03",
        title: "Collect",
        description: "Collects phone number, city, address, variant, and quantity when needed.",
        icon: "collect",
      },
      {
        number: "04",
        title: "Confirm",
        description: "Shows a clear order summary so customers can confirm or correct details.",
        icon: "check",
      },
      {
        number: "05",
        title: "Organize",
        description: "Turns the conversation into a structured order the seller can manage.",
        icon: "folder",
      },
    ],
  },
  features: {
    id: marketingSections.features,
    eyebrow: "Built for conversational commerce",
    title: "Everything the sales conversation needs to keep moving.",
    description:
      "AgentWhatsApp combines customer understanding, configurable sales flows, and structured order collection in one experience.",
    items: [
      {
        title: "Darija and Arabizi understanding",
        description: "Handles natural Moroccan customer messages instead of relying only on rigid keywords.",
        icon: "brain",
      },
      {
        title: "Configurable first response",
        description: "Control how the agent introduces the product, price, delivery, payment, and next action.",
        icon: "sliders",
      },
      {
        title: "Product information and guidance",
        description: "Answers common questions and helps customers choose relevant options without repeated static replies.",
        icon: "message",
      },
      {
        title: "Structured order collection",
        description: "Collects only missing fields and keeps each customer’s order context separate.",
        icon: "collect",
      },
      {
        title: "Confirmation and corrections",
        description: "Shows a complete summary, supports edits, and lets the customer confirm before finalization.",
        icon: "check",
      },
      {
        title: "Order summary and receipt",
        description: "Creates a clear order summary and supports a branded receipt or document after confirmation.",
        icon: "receipt",
      },
    ],
  },
  howItWorks: {
    id: marketingSections.howItWorks,
    eyebrow: "Simple to set up",
    title: "Set up the sales flow. Let AgentWhatsApp handle the repetition.",
    description:
      "Configure the essentials once, then let the agent guide customer conversations using your product and order requirements.",
    steps: [
      {
        number: "01",
        title: "Add your product",
        description: "Add product details, price, delivery rules, available options, and required order fields.",
        icon: "package",
      },
      {
        number: "02",
        title: "Connect WhatsApp",
        description: "Connect your WhatsApp Business setup through the official Cloud API flow.",
        icon: "link",
      },
      {
        number: "03",
        title: "Start receiving structured orders",
        description: "The agent answers customers, collects order details, and prepares confirmed orders for seller follow-up.",
        icon: "rocket",
      },
    ],
  },
};
