import { env } from "../../../config/env";
import type { InteractiveSendDecision } from "../../agent/reply/interactive-send-decision.types";
import type { WhatsAppInteractivePreview } from "../../agent/reply/whatsapp-interactive.types";
import type { CloudReplyDispatchResult } from "./cloud-reply-dispatch.types";
import type { WhatsAppCloudSendResult } from "./whatsapp-cloud.types";
import {
  sendCloudInteractiveMessage,
  sendCloudText,
} from "./whatsapp-cloud.service";

function isSuccessfulSendResult(
  result: WhatsAppCloudSendResult,
): boolean {
  return result.success === true;
}

function maskPhone(value: string): string {
  return value.length > 6
    ? `${value.slice(0, 3)}***${value.slice(-3)}`
    : "***";
}

function logDispatch(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload));
}

export class CloudReplyDispatchService {
  async dispatchAgentReply(input: {
    to: string;
    phoneNumberId?: string;
    replyText: string;
    whatsappInteractivePreview?: WhatsAppInteractivePreview | null;
    interactiveSendDecision?: InteractiveSendDecision | null;
    forceDryRun?: boolean;
    cloudDryRunOverride?: boolean;
    interactiveLiveSendAllowedOverride?: boolean;
    simulateNoProviderCall?: boolean;
  }): Promise<CloudReplyDispatchResult> {
    const shouldUseInteractive =
      input.interactiveSendDecision?.mode === "interactive_preview" &&
      Boolean(input.whatsappInteractivePreview);
    const effectiveForceDryRun =
      input.forceDryRun === true || input.simulateNoProviderCall === true;
    const cloudDryRun =
      input.simulateNoProviderCall === true
        ? input.cloudDryRunOverride ?? env.whatsappCloudDryRun
        : env.whatsappCloudDryRun;
    const interactiveLiveSendAllowed =
      input.interactiveLiveSendAllowedOverride ??
      env.whatsappInteractiveLiveSendAllowed;
    const interactiveType =
      input.whatsappInteractivePreview?.interactive?.type ||
      input.interactiveSendDecision?.interactiveType;

    if (!shouldUseInteractive) {
      const textResult = await sendCloudText({
        to: input.to,
        phoneNumberId: input.phoneNumberId,
        text: input.replyText,
        forceDryRun: effectiveForceDryRun,
      });
      const result: CloudReplyDispatchResult = {
        ok: isSuccessfulSendResult(textResult),
        mode: "text",
        dryRun: textResult.dryRun,
        reason: "text_only_decision",
        textResult,
        error: textResult.errorMessage,
      };

      logDispatch({
        event: "whatsapp.cloud.reply.dispatch",
        channel: input.interactiveSendDecision?.channel || "unknown",
        mode: result.mode,
        dryRun: result.dryRun,
        fallbackUsed: result.fallbackUsed || false,
        reason: result.reason,
        interactiveEnabled: input.interactiveSendDecision?.interactiveEnabled,
        interactiveLiveSendAllowed,
        interactiveType,
        waId: maskPhone(input.to),
      });

      return result;
    }

    if (
      input.forceDryRun !== true &&
      cloudDryRun !== true &&
      input.simulateNoProviderCall !== true &&
      interactiveLiveSendAllowed !== true
    ) {
      const textResult = await sendCloudText({
        to: input.to,
        phoneNumberId: input.phoneNumberId,
        text: input.replyText,
      });
      const result: CloudReplyDispatchResult = {
        ok: isSuccessfulSendResult(textResult),
        mode: "text",
        dryRun: textResult.dryRun,
        fallbackUsed: true,
        interactiveBlocked: true,
        reason: "interactive_blocked_by_live_guard",
        textResult,
        error: textResult.errorMessage,
      };

      logDispatch({
        event: "whatsapp.cloud.reply.dispatch",
        channel: input.interactiveSendDecision?.channel || "unknown",
        mode: result.mode,
        dryRun: result.dryRun,
        fallbackUsed: true,
        interactiveBlocked: true,
        reason: result.reason,
        interactiveEnabled: input.interactiveSendDecision?.interactiveEnabled,
        interactiveLiveSendAllowed,
        interactiveType,
        waId: maskPhone(input.to),
      });

      return result;
    }

    if (
      input.forceDryRun !== true &&
      cloudDryRun !== true &&
      input.simulateNoProviderCall === true &&
      interactiveLiveSendAllowed !== true
    ) {
      const textResult = await sendCloudText({
        to: input.to,
        phoneNumberId: input.phoneNumberId,
        text: input.replyText,
        forceDryRun: true,
      });
      const result: CloudReplyDispatchResult = {
        ok: isSuccessfulSendResult(textResult),
        mode: "text",
        dryRun: textResult.dryRun,
        fallbackUsed: true,
        interactiveBlocked: true,
        reason: "interactive_blocked_by_live_guard",
        textResult,
        error: textResult.errorMessage,
      };

      logDispatch({
        event: "whatsapp.cloud.reply.dispatch",
        channel: input.interactiveSendDecision?.channel || "unknown",
        mode: result.mode,
        dryRun: result.dryRun,
        fallbackUsed: true,
        interactiveBlocked: true,
        reason: result.reason,
        interactiveEnabled: input.interactiveSendDecision?.interactiveEnabled,
        interactiveLiveSendAllowed,
        interactiveType,
        waId: maskPhone(input.to),
        simulateNoProviderCall: true,
      });

      return result;
    }

    const interactiveResult = await sendCloudInteractiveMessage({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      interactivePreview: input.whatsappInteractivePreview as WhatsAppInteractivePreview,
      forceDryRun: effectiveForceDryRun,
    });

    if (isSuccessfulSendResult(interactiveResult)) {
      const result: CloudReplyDispatchResult = {
        ok: true,
        mode: "interactive",
        dryRun: interactiveResult.dryRun,
        reason: "interactive_decision",
        interactiveResult,
      };

      logDispatch({
        event: "whatsapp.cloud.reply.dispatch",
        channel: input.interactiveSendDecision?.channel || "unknown",
        mode: result.mode,
        dryRun: result.dryRun,
        fallbackUsed: false,
        reason: result.reason,
        interactiveEnabled: input.interactiveSendDecision?.interactiveEnabled,
        interactiveLiveSendAllowed,
        interactiveType,
        waId: maskPhone(input.to),
      });

      return result;
    }

    const textResult = await sendCloudText({
      to: input.to,
      phoneNumberId: input.phoneNumberId,
      text: input.replyText,
      forceDryRun: effectiveForceDryRun,
    });

    const result: CloudReplyDispatchResult = {
      ok: isSuccessfulSendResult(textResult),
      mode: "text",
      dryRun: textResult.dryRun,
      fallbackUsed: true,
      reason: "interactive_failed_fallback_text",
      textResult,
      interactiveResult,
      error: textResult.errorMessage || interactiveResult.errorMessage,
    };

    logDispatch({
      event: "whatsapp.cloud.reply.dispatch",
      channel: input.interactiveSendDecision?.channel || "unknown",
      mode: result.mode,
      dryRun: result.dryRun,
      fallbackUsed: true,
      reason: result.reason,
      interactiveEnabled: input.interactiveSendDecision?.interactiveEnabled,
      interactiveLiveSendAllowed,
      interactiveType,
      waId: maskPhone(input.to),
    });

    return result;
  }
}

export const cloudReplyDispatchService = new CloudReplyDispatchService();
