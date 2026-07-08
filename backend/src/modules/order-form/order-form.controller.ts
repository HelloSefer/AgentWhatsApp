import type { Request, Response } from "express";
import { env } from "../../config/env";
import { conversationKeyService } from "../agent/identity/conversation-key.service";
import { sellerResolverService } from "../agent/identity/seller-resolver.service";
import { updateConversationOrderState } from "../agent/session/conversation-session.service";
import {
  recordOrderFormOpened,
  recordOrderFormSubmitted,
  recordOrderFormTokenInvalid,
  sendCloudText,
} from "../whatsapp/cloud/whatsapp-cloud.service";
import {
  buildOrderFormConfirmationSummary,
  createOrderFormToken,
  getOrderFormMissingFields,
  normalizeOrderFormSubmission,
  renderOrderFormPage,
  resolveOrderFormBaseUrl,
  verifyOrderFormToken,
} from "./order-form.service";

function logJson(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload));
}

function maskPhone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > 6
    ? `${value.slice(0, 3)}***${value.slice(-3)}`
    : "***";
}

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto || req.protocol;

  return `${proto}://${req.get("host")}`;
}

export function renderOrderForm(req: Request, res: Response) {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const tokenResult = verifyOrderFormToken(token);

  if (tokenResult.ok) {
    recordOrderFormOpened();
    logJson({
      event: "order_form.page.opened",
      waId: maskPhone(tokenResult.payload.waId),
      phoneNumberId: tokenResult.payload.phoneNumberId,
    });
  } else {
    recordOrderFormTokenInvalid();
    logJson({
      event: "order_form.token_invalid",
      reason: tokenResult.errorMessage,
    });
  }

  return res.type("html").send(
    renderOrderFormPage({
      token,
      tokenResult,
    }),
  );
}

export async function submitOrderForm(req: Request, res: Response) {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const tokenResult = verifyOrderFormToken(token);

  if (!tokenResult.ok) {
    recordOrderFormTokenInvalid();
    logJson({
      event: "order_form.token_invalid",
      reason: tokenResult.errorMessage,
    });

    return res.status(400).json({
      ok: false,
      message: tokenResult.errorMessage,
    });
  }

  const order = normalizeOrderFormSubmission(req.body);
  const missingFields = getOrderFormMissingFields(order);

  if (missingFields.length > 0) {
    return res.status(400).json({
      ok: false,
      message: "عافاك عمّر جميع المعلومات المطلوبة.",
      missingFields,
    });
  }

  const sellerId = sellerResolverService.resolveSellerIdByPhoneNumberId(
    tokenResult.payload.phoneNumberId,
  );
  const customerPhone = tokenResult.payload.waId;
  const conversationKey = conversationKeyService.buildConversationKey(
    sellerId,
    customerPhone,
  );

  await updateConversationOrderState({
    customerId: conversationKey,
    customerPhone,
    conversationKey,
    sellerId,
    collected: order,
    missingFields: [],
    isComplete: true,
    awaitingConfirmation: true,
    confirmed: false,
  });

  logJson({
    event: "order_form.submitted",
    waId: maskPhone(tokenResult.payload.waId),
    phoneNumberId: tokenResult.payload.phoneNumberId,
  });
  recordOrderFormSubmitted();

  const summary = buildOrderFormConfirmationSummary(order);
  const sendResult = await sendCloudText({
    to: tokenResult.payload.waId,
    phoneNumberId: tokenResult.payload.phoneNumberId,
    text: summary,
  });

  logJson({
    event: "order_form.confirmation_summary_sent",
    waId: maskPhone(tokenResult.payload.waId),
    success: sendResult.success,
  });

  return res.status(200).json({
    ok: true,
    message: "توصلنا بمعلوماتك. رجع للواتساب باش تأكد الطلب.",
    sendSuccess: sendResult.success,
  });
}

export function testOrderFormLink(req: Request, res: Response) {
  if (env.nodeEnv === "production" && !env.whatsappCloudAllowDevTools) {
    return res.status(403).json({
      message: "Order form test-link endpoint is disabled in production",
    });
  }

  const waId = typeof req.body?.waId === "string" ? req.body.waId.trim() : "";
  const phoneNumberId =
    typeof req.body?.phoneNumberId === "string"
      ? req.body.phoneNumberId.trim()
      : "";

  if (!waId || !phoneNumberId) {
    return res.status(400).json({
      message: "waId and phoneNumberId are required",
    });
  }

  const token = createOrderFormToken({ waId, phoneNumberId });
  const base = resolveOrderFormBaseUrl(getRequestBaseUrl(req));
  const url = new URL("/order-form", base.baseUrl);

  url.searchParams.set("token", token);

  logJson({
    event: "order_form.link_generated",
    publicBaseUrl: base.baseUrl,
    usedFallbackBaseUrl: base.usedFallbackBaseUrl,
  });

  return res.status(200).json({
    url: url.toString(),
    token,
    baseUrlSource: base.baseUrlSource,
    publicBaseUrlConfigured: base.publicBaseUrlConfigured,
  });
}
