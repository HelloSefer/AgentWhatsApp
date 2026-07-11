import type { Request, Response } from "express";
import { env } from "../../../config/env";
import { generateAgentResult } from "../../agent/agent.service";
import {
  buildOrderFormUrl,
  resolveOrderFormBaseUrl,
} from "../../order-form/order-form.service";
import { normalizeCloudIncomingMessage } from "./cloud-interactive-reply-normalizer.service";
import { buildLiveInteractiveReadiness } from "./cloud-live-interactive-readiness.service";
import { cloudReplyDispatchService } from "./cloud-reply-dispatch.service";
import {
  buildSimulatedIncomingWebhook,
  checkSubscribedApps,
  dispatchAgentResultThroughCloud,
  getCloudDiagnostics,
  processCloudWebhookBody,
  recordCloudWebhookVerify,
  sendCtaUrl,
  sendCloudText,
  sendCloudInteractiveMessage,
  sendOrderFlow,
  sendReplyButtonPreset,
  subscribeAppToWaba,
  verifyWebhookSignature,
  isReplyButtonPreset,
} from "./whatsapp-cloud.service";

function getQueryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol;

  return `${protocol}://${req.get("host")}`;
}

export function verifyWhatsAppCloudWebhook(req: Request, res: Response) {
  const mode = getQueryString(req.query["hub.mode"]);
  const verifyToken = getQueryString(req.query["hub.verify_token"]);
  const challenge = getQueryString(req.query["hub.challenge"]);
  const verifyTokenMatched = verifyToken === env.whatsappCloudVerifyToken;
  const success = mode === "subscribe" && verifyTokenMatched && Boolean(challenge);

  recordCloudWebhookVerify({
    mode,
    verifyTokenMatched,
    challenge,
    success,
  });

  if (success) {
    return res.status(200).type("text/plain").send(challenge);
  }

  return res.status(403).json({
    message: "Webhook verification failed",
  });
}

export function getWhatsAppCloudDiagnostics(_req: Request, res: Response) {
  return res.status(200).json(getCloudDiagnostics());
}

export function getWhatsAppCloudLiveInteractiveReadiness(
  req: Request,
  res: Response,
) {
  const testRecipientPhone = getQueryString(req.query.testRecipientPhone);
  const sellerId = getQueryString(req.query.sellerId);

  return res.status(200).json(
    buildLiveInteractiveReadiness({
      testRecipientPhone,
      sellerId,
    }),
  );
}

export function testNormalizeWhatsAppCloudInteractiveReply(
  req: Request,
  res: Response,
) {
  const normalized = normalizeCloudIncomingMessage(req.body?.message);

  return res.status(200).json({
    ok: true,
    normalized,
  });
}

export async function receiveWhatsAppCloudWebhook(req: Request, res: Response) {
  const isSignatureValid = verifyWebhookSignature({
    signature:
      typeof req.header("x-hub-signature-256") === "string"
        ? req.header("x-hub-signature-256")
        : undefined,
    rawBody: (req as typeof req & { rawBody?: Buffer }).rawBody,
  });

  if (!isSignatureValid) {
    return res.status(403).json({
      message: "Invalid webhook signature",
    });
  }

  res.status(200).json({ ok: true });

  processCloudWebhookBody(req.body, {
    publicBaseUrl: getRequestBaseUrl(req),
  }).catch((error) => {
    console.error(
      JSON.stringify({
        event: "whatsapp.cloud.error",
        step: "webhook_background_processing",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  });
}

export async function getWhatsAppCloudSubscribedApps(
  _req: Request,
  res: Response,
) {
  if (!env.whatsappCloudAccessToken) {
    return res.status(400).json({
      success: false,
      graphStatus: 400,
      response: null,
      errorMessage: "WHATSAPP_CLOUD_ACCESS_TOKEN is required",
    });
  }

  try {
    const result = await checkSubscribedApps();

    return res.status(result.success ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      graphStatus: 500,
      response: null,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function isDevToolAllowed(): boolean {
  return env.nodeEnv !== "production" || env.whatsappCloudAllowDevTools;
}

export async function subscribeWhatsAppCloudApp(req: Request, res: Response) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      success: false,
      graphStatus: 403,
      response: null,
      errorMessage: "Cloud dev tools are disabled in production",
    });
  }

  if (!env.whatsappCloudAccessToken) {
    return res.status(400).json({
      success: false,
      graphStatus: 400,
      response: null,
      errorMessage: "WHATSAPP_CLOUD_ACCESS_TOKEN is required",
    });
  }

  const subscribedFields = Array.isArray(req.body?.subscribed_fields)
    ? req.body.subscribed_fields.filter(
        (field: unknown): field is string =>
          typeof field === "string" && Boolean(field.trim()),
      )
    : undefined;

  try {
    const result = await subscribeAppToWaba(subscribedFields);

    return res.status(result.success ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      graphStatus: 500,
      response: null,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function simulateWhatsAppCloudIncoming(req: Request, res: Response) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      ok: false,
      message: "Cloud simulation endpoint is disabled in production",
    });
  }

  const from =
    typeof req.body?.from === "string" && req.body.from.trim()
      ? req.body.from.trim()
      : "";
  const text =
    typeof req.body?.text === "string" && req.body.text.trim()
      ? req.body.text.trim()
      : "";
  const buttonReplyId =
    typeof req.body?.buttonReplyId === "string" && req.body.buttonReplyId.trim()
      ? req.body.buttonReplyId.trim()
      : "";
  const buttonReplyTitle =
    typeof req.body?.buttonReplyTitle === "string" &&
    req.body.buttonReplyTitle.trim()
      ? req.body.buttonReplyTitle.trim()
      : "";
  const phoneNumberId =
    typeof req.body?.phoneNumberId === "string" && req.body.phoneNumberId.trim()
      ? req.body.phoneNumberId.trim()
      : undefined;

  if (!from || (!text && !buttonReplyId)) {
    return res.status(400).json({
      ok: false,
      message: "from and text or buttonReplyId are required",
    });
  }

  try {
    const result = await processCloudWebhookBody(
      buildSimulatedIncomingWebhook({
        from,
        phoneNumberId,
        text,
        buttonReplyId,
        buttonReplyTitle,
      }),
      {
        publicBaseUrl: getRequestBaseUrl(req),
        allowUnknownPhoneNumberId: true,
      },
    );

    return res.status(200).json({
      ok: true,
      handled: result.handled,
      agentReplyPreview: result.agentReplyPreview,
      actionsCount: result.actionsCount,
      sendAttempted: result.sendAttempted,
      sendSuccess: result.sendSuccess,
      identity: result.identity,
      diagnostics: getCloudDiagnostics(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Cloud incoming simulation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudSendText(req: Request, res: Response) {
  if (env.nodeEnv === "production" && !env.whatsappCloudDryRun) {
    return res.status(403).json({
      message: "Test send endpoint is disabled in production",
    });
  }

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

  if (!to || !text) {
    return res.status(400).json({
      message: "to and text are required",
    });
  }

  try {
    const result = await sendCloudText({ to, text });

    return res.status(result.success ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Cloud API test send failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudSendInteractivePreview(
  req: Request,
  res: Response,
) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      success: false,
      dryRun: true,
      payload: null,
      response: null,
      errorMessage: "Cloud interactive preview test endpoint is disabled in production",
    });
  }

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const phoneNumberId =
    typeof req.body?.phoneNumberId === "string" && req.body.phoneNumberId.trim()
      ? req.body.phoneNumberId.trim()
      : env.whatsappCloudPhoneNumberId;
  const interactivePreview = req.body?.interactivePreview;

  if (!to) {
    return res.status(400).json({
      success: false,
      dryRun: true,
      payload: null,
      response: null,
      errorMessage: "to is required",
    });
  }

  if (!interactivePreview || typeof interactivePreview !== "object") {
    return res.status(400).json({
      success: false,
      dryRun: true,
      payload: null,
      response: null,
      errorMessage: "interactivePreview is required",
    });
  }

  try {
    const result = await sendCloudInteractiveMessage({
      to,
      phoneNumberId,
      interactivePreview,
      forceDryRun: true,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      dryRun: true,
      payload: null,
      response: null,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudDispatchAgentReply(
  req: Request,
  res: Response,
) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      ok: false,
      mode: "text",
      dryRun: true,
      error: "Cloud reply dispatch test endpoint is disabled in production",
    });
  }

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const phoneNumberId =
    typeof req.body?.phoneNumberId === "string" && req.body.phoneNumberId.trim()
      ? req.body.phoneNumberId.trim()
      : env.whatsappCloudPhoneNumberId;
  const replyText =
    typeof req.body?.replyText === "string" ? req.body.replyText.trim() : "";
  const forceDryRun = req.body?.forceDryRun === false ? false : true;

  if (!to || !replyText) {
    return res.status(400).json({
      ok: false,
      mode: "text",
      dryRun: true,
      error: "to and replyText are required",
    });
  }

  try {
    const result = await cloudReplyDispatchService.dispatchAgentReply({
      to,
      phoneNumberId,
      replyText,
      whatsappInteractivePreview: req.body?.whatsappInteractivePreview || null,
      interactiveSendDecision: req.body?.interactiveSendDecision || null,
      forceDryRun,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mode: "text",
      dryRun: forceDryRun,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudAgentDispatchFlow(
  req: Request,
  res: Response,
) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      ok: false,
      message: "Cloud agent dispatch flow test endpoint is disabled in production",
    });
  }

  const sellerId =
    typeof req.body?.sellerId === "string" && req.body.sellerId.trim()
      ? req.body.sellerId.trim()
      : undefined;
  const customerPhone =
    typeof req.body?.customerPhone === "string" && req.body.customerPhone.trim()
      ? req.body.customerPhone.trim()
      : "";
  const message =
    typeof req.body?.message === "string" && req.body.message.trim()
      ? req.body.message.trim()
      : "";
  const cloudMessage =
    req.body?.cloudMessage && typeof req.body.cloudMessage === "object"
      ? req.body.cloudMessage
      : undefined;
  const cloudNormalization =
    !message && cloudMessage
      ? normalizeCloudIncomingMessage(cloudMessage)
      : undefined;
  const agentInputText =
    message || cloudNormalization?.normalizedText?.trim() || "";
  const phoneNumberId =
    typeof req.body?.phoneNumberId === "string" && req.body.phoneNumberId.trim()
      ? req.body.phoneNumberId.trim()
      : env.whatsappCloudPhoneNumberId;
  const forceDryRun = req.body?.forceDryRun === false ? false : true;
  const simulateNoProviderCall = req.body?.simulateNoProviderCall === true;
  const interactiveEnabledOverride =
    typeof req.body?.interactiveEnabledOverride === "boolean"
      ? req.body.interactiveEnabledOverride
      : undefined;
  const interactiveLiveSendAllowedOverride =
    typeof req.body?.interactiveLiveSendAllowedOverride === "boolean"
      ? req.body.interactiveLiveSendAllowedOverride
      : undefined;

  if (!customerPhone || !agentInputText) {
    return res.status(400).json({
      ok: false,
      message: "customerPhone and message or cloudMessage are required",
      ...(cloudNormalization ? { cloudNormalization } : {}),
    });
  }

  try {
    const agentResult = await generateAgentResult(agentInputText, undefined, {
      customerPhone,
      sellerId,
      phoneNumberId,
      useMemory: true,
      interactiveSendChannel: "whatsapp_cloud",
      interactiveEnabledOverride,
    });
    const dispatchFlow = await dispatchAgentResultThroughCloud({
      to: customerPhone,
      phoneNumberId,
      customerId: customerPhone,
      userMessage: agentInputText,
      result: agentResult,
      forceDryRun,
      interactiveLiveSendAllowedOverride,
      simulateNoProviderCall,
    });
    const dispatchSafety = {
      interactiveEnabled:
        interactiveEnabledOverride ?? env.whatsappInteractiveEnabled,
      interactiveLiveSendAllowed:
        interactiveLiveSendAllowedOverride ??
        env.whatsappInteractiveLiveSendAllowed,
      cloudDryRun: env.whatsappCloudDryRun,
      forceDryRun,
      simulateNoProviderCall,
    };

    return res.status(200).json({
      ok: true,
      reply: agentResult.reply,
      actions: agentResult.actions,
      source: agentResult.source,
      meta: agentResult.meta,
      ...(cloudNormalization ? { cloudNormalization } : {}),
      dispatchSafety,
      dispatchResult: dispatchFlow.dispatchResult,
      orderConfirmationSplit: dispatchFlow.orderConfirmationSplit,
      ...(dispatchFlow.reviewDispatchResult
        ? { reviewDispatchResult: dispatchFlow.reviewDispatchResult }
        : {}),
      ...(dispatchFlow.reviewFailureFallbackResult
        ? {
            reviewFailureFallbackResult:
              dispatchFlow.reviewFailureFallbackResult,
          }
        : {}),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Cloud agent dispatch flow test failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudSendOrderFlow(
  req: Request,
  res: Response,
) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "Cloud Flow test endpoint is disabled in production",
    });
  }

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";

  if (!to) {
    return res.status(400).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "to is required",
    });
  }

  try {
    const result = await sendOrderFlow(to);

    return res.status(result.success ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudSendOrderFormCta(
  req: Request,
  res: Response,
) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "Cloud CTA URL test endpoint is disabled in production",
    });
  }

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const phoneNumberId = env.whatsappCloudPhoneNumberId;

  if (!to) {
    return res.status(400).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "to is required",
    });
  }

  if (!phoneNumberId) {
    return res.status(400).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "WHATSAPP_CLOUD_PHONE_NUMBER_ID is required",
    });
  }

  try {
    const base = resolveOrderFormBaseUrl(getRequestBaseUrl(req));
    const url = buildOrderFormUrl({
      publicBaseUrl: base.baseUrl,
      waId: to,
      phoneNumberId,
    });

    const result = await sendCtaUrl({
      to,
      phoneNumberId,
      url,
      bodyText: "باش نكملو الطلب بسرعة، ضغط على الزر وعمّر معلوماتك:",
      buttonText: "كمّل معلومات الطلب",
    });

    return res.status(result.success ? 200 : 502).json({
      ...result,
      url,
      baseUrlSource: base.baseUrlSource,
      publicBaseUrlConfigured: base.publicBaseUrlConfigured,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testWhatsAppCloudSendReplyButtons(
  req: Request,
  res: Response,
) {
  if (!isDevToolAllowed()) {
    return res.status(403).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "Cloud Reply Buttons test endpoint is disabled in production",
    });
  }

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const preset = typeof req.body?.preset === "string" ? req.body.preset.trim() : "";
  const emoji = req.body?.emoji === false ? false : true;

  if (!to) {
    return res.status(400).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: "to is required",
    });
  }

  if (!isReplyButtonPreset(preset)) {
    return res.status(400).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage:
        "preset must be one of: order_confirmation, color_choice, after_price",
    });
  }

  try {
    const result = await sendReplyButtonPreset({
      to,
      phoneNumberId: env.whatsappCloudPhoneNumberId,
      preset,
      emoji,
    });

    return res.status(result.success ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      dryRun: env.whatsappCloudDryRun,
      payload: null,
      response: null,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
