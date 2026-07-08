import type { SellerConfig } from "./seller-config.types";

export const demoSellerConfigs: SellerConfig[] = [
  {
    sellerId: "seller_demo_sandals",
    businessName: "Demo Sandals Store",
    languageStyle: "darija",
    showPriceOnFirstReply: true,
    delivery: {
      enabled: true,
      free: false,
      text: "التوصيل حتى لباب الدار",
      paymentOnDelivery: true,
      paymentText: "الأداء عند الاستلام",
    },
    customerFields: [
      {
        key: "fullName",
        label: "الاسم الكامل",
        required: true,
        enabled: true,
        askOrder: 1,
      },
      {
        key: "phone",
        label: "رقم الهاتف",
        required: true,
        enabled: true,
        askOrder: 2,
      },
      {
        key: "city",
        label: "المدينة",
        required: true,
        enabled: true,
        askOrder: 3,
      },
      {
        key: "address",
        label: "العنوان",
        required: true,
        enabled: true,
        askOrder: 4,
      },
    ],
    interactive: {
      firstReplyMode: "buttons",
      optionDisplayMode: "auto",
      infoMenuDisplayMode: "list",
    },
    receipt: {
      enabled: true,
      showLogo: true,
      footerText: "شكراً على ثقتك.",
    },
    ai: {
      mode: "hybrid",
      naturalReplyEnabled: false,
    },
  },
  {
    sellerId: "seller_demo_medical",
    businessName: "Demo Medical Store",
    languageStyle: "darija",
    showPriceOnFirstReply: true,
    delivery: {
      enabled: true,
      free: false,
      text: "التوصيل متوفر حتى لباب الدار",
      paymentOnDelivery: true,
      paymentText: "الأداء عند الاستلام",
    },
    customerFields: [
      {
        key: "fullName",
        label: "الاسم الكامل",
        required: true,
        enabled: true,
        askOrder: 1,
      },
      {
        key: "phone",
        label: "رقم الهاتف",
        required: true,
        enabled: true,
        askOrder: 2,
      },
      {
        key: "city",
        label: "المدينة",
        required: true,
        enabled: true,
        askOrder: 3,
      },
      {
        key: "address",
        label: "العنوان",
        required: false,
        enabled: false,
        askOrder: 4,
      },
    ],
    interactive: {
      firstReplyMode: "buttons",
      optionDisplayMode: "auto",
      infoMenuDisplayMode: "list",
    },
    receipt: {
      enabled: true,
      showLogo: true,
      footerText: "شكراً على ثقتك.",
    },
    ai: {
      mode: "hybrid",
      naturalReplyEnabled: false,
    },
  },
];
