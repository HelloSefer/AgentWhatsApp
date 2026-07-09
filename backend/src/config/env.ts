import dotenv from "dotenv";

dotenv.config();

const orderFormFallbackSendMode =
  process.env.ORDER_FORM_FALLBACK_SEND_MODE === "text" ? "text" : "cta_url";

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  appName: process.env.APP_NAME || "Moroccan Darija WhatsApp AI Sales Agent",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen2.5:7b",
  naturalReplyEnabled: process.env.NATURAL_REPLY_ENABLED === "true",
  naturalReplyModel: process.env.NATURAL_REPLY_MODEL || "qwen2.5:3b",
  naturalReplyTimeoutMs: Number(process.env.NATURAL_REPLY_TIMEOUT_MS) || 1500,
  naturalReplyMaxTokens: Number(process.env.NATURAL_REPLY_MAX_TOKENS) || 60,
  naturalReplyTemperature:
    Number(process.env.NATURAL_REPLY_TEMPERATURE) || 0.3,
  naturalReplyTopP: Number(process.env.NATURAL_REPLY_TOP_P) || 0.8,
  naturalReplyNumCtx: Number(process.env.NATURAL_REPLY_NUM_CTX) || 768,
  naturalReplyWarmupEnabled:
    process.env.NATURAL_REPLY_WARMUP_ENABLED === "true",
  valkeyUrl: process.env.VALKEY_URL || "redis://localhost:6379",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS) || 172800,
  whatsappProvider: process.env.WHATSAPP_PROVIDER || "baileys",
  whatsappCloudApiVersion:
    process.env.WHATSAPP_CLOUD_API_VERSION || "v25.0",
  whatsappCloudAccessToken: process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || "",
  whatsappCloudPhoneNumberId:
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || "",
  whatsappCloudBusinessAccountId:
    process.env.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID || "",
  whatsappCloudVerifyToken:
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN || "agentwhatsapp_verify_123",
  whatsappCloudAppSecret: process.env.WHATSAPP_CLOUD_APP_SECRET || "",
  whatsappCloudWebhookSignatureVerify:
    process.env.WHATSAPP_CLOUD_WEBHOOK_SIGNATURE_VERIFY === "true",
  whatsappCloudDryRun: process.env.WHATSAPP_CLOUD_DRY_RUN === "true",
  whatsappCloudAllowDevTools:
    process.env.WHATSAPP_CLOUD_ALLOW_DEV_TOOLS === "true",
  whatsappCloudOrderFlowId: process.env.WHATSAPP_CLOUD_ORDER_FLOW_ID || "",
  whatsappCloudOrderFlowScreenId:
    process.env.WHATSAPP_CLOUD_ORDER_FLOW_SCREEN_ID || "ORDER_FORM",
  whatsappCloudOrderFlowCta:
    process.env.WHATSAPP_CLOUD_ORDER_FLOW_CTA || "كملي معلومات الطلب",
  whatsappCloudOrderFlowOnOrderStart:
    process.env.WHATSAPP_CLOUD_ORDER_FLOW_ON_ORDER_START === "true",
  whatsappCloudOrderFlowInitialDataJson:
    process.env.WHATSAPP_CLOUD_ORDER_FLOW_INITIAL_DATA_JSON || "",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
  orderFormFallbackEnabled:
    process.env.ORDER_FORM_FALLBACK_ENABLED !== "false",
  orderFormFallbackSendMode,
  orderFormTokenSecret: process.env.ORDER_FORM_TOKEN_SECRET || "",
  whatsappCloudReplyButtonsEnabled:
    process.env.WHATSAPP_CLOUD_REPLY_BUTTONS_ENABLED !== "false",
  whatsappInteractiveEnabled:
    process.env.WHATSAPP_INTERACTIVE_ENABLED === "true",
  whatsappInteractiveLiveSendAllowed:
    process.env.WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED === "true",
  firstEntryLiveSmokeEnabled:
    process.env.FIRST_ENTRY_LIVE_SMOKE_ENABLED === "true",
  firstEntryLiveSmokeTestRecipient:
    process.env.FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT || "212600000000",
  firstEntryLiveSmokeSellerId:
    process.env.FIRST_ENTRY_LIVE_SMOKE_SELLER_ID || "seller_demo_sandals",
  orderReceiptPdfEnabled: process.env.ORDER_RECEIPT_PDF_ENABLED === "true",
  orderReceiptStoreName:
    process.env.ORDER_RECEIPT_STORE_NAME || "AN9A STORE",
  orderReceiptSupportPhone: process.env.ORDER_RECEIPT_SUPPORT_PHONE || "",
  orderReceiptLogoPath: process.env.ORDER_RECEIPT_LOGO_PATH || "",
  orderReceiptOutputDir:
    process.env.ORDER_RECEIPT_OUTPUT_DIR || "storage/receipts",
  orderReceiptSendToCustomer:
    process.env.ORDER_RECEIPT_SEND_TO_CUSTOMER !== "false",
  orderReceiptDeleteAfterSend:
    process.env.ORDER_RECEIPT_DELETE_AFTER_SEND === "true",
  orderReceiptKeepFailedFiles:
    process.env.ORDER_RECEIPT_KEEP_FAILED_FILES !== "false",
  orderReceiptCleanupOnStart:
    process.env.ORDER_RECEIPT_CLEANUP_ON_START === "true",
  orderReceiptCleanupMaxAgeHours:
    Number(process.env.ORDER_RECEIPT_CLEANUP_MAX_AGE_HOURS) || 24,
  whatsappInteractiveChoicesEnabled:
    process.env.WHATSAPP_INTERACTIVE_CHOICES_ENABLED !== "false",
  whatsappInteractiveChoicesMode:
    process.env.WHATSAPP_INTERACTIVE_CHOICES_MODE || "auto",
};
