import { marketingSections } from "@/config/site";
import type { FaqItem, MarketingSectionContent } from "../types/marketing.types";

export const faqContent: MarketingSectionContent = {
  id: marketingSections.faq,
  eyebrow: "Frequently asked questions",
  title: "Practical answers before you get started.",
  description: "A quick overview of how AgentWhatsApp fits into a WhatsApp commerce workflow.",
};

export const faqItems: readonly FaqItem[] = [
  {
    question: "Does AgentWhatsApp understand Darija and Arabizi?",
    answer:
      "Yes. It is designed to understand common Moroccan customer language, including Darija, Arabic, French-influenced phrases, and Arabizi-style messages.",
  },
  {
    question: "Is it suitable for cash-on-delivery businesses?",
    answer:
      "Yes. The flow is designed around collecting customer and delivery information required for COD-style e-commerce orders.",
  },
  {
    question: "Can I configure product prices, options, and delivery information?",
    answer:
      "Yes. Sellers can configure product details, price visibility, available options, delivery rules, payment information, and required order fields.",
  },
  {
    question: "Does it collect the complete order in one message?",
    answer:
      "Not necessarily. It collects information progressively and asks only for details that are still missing.",
  },
  {
    question: "Can customers correct their information before confirmation?",
    answer:
      "Yes. Customers can review the order summary and correct details before final confirmation.",
  },
  {
    question: "Can it generate an order summary or receipt?",
    answer:
      "Yes. After confirmation, the system supports a clear summary and a branded receipt or document.",
  },
  {
    question: "Does it use the official WhatsApp Cloud API?",
    answer: "Yes. The platform direction uses Meta’s official WhatsApp Cloud API for WhatsApp communication.",
  },
  {
    question: "Do I need technical knowledge to use it?",
    answer:
      "The platform is being designed so sellers can configure products and sales settings from a clear dashboard without managing the underlying technical system.",
  },
];
