import type { Request, Response } from "express";
import type { AuthorizedRequest } from "../../auth/http/auth-request.types";
import type { EmbeddedSignupCompletionService } from "../application/embedded-signup-completion.service";
import { WhatsAppConnectionCompletionValidationError } from "../domain/whatsapp-connection.errors";
import { sendWhatsappConnectionError } from "./whatsapp-connection-http.errors";

const ACCEPTED_BODY_KEYS = new Set(["code", "wabaId", "phoneNumberId"]);

function bodyRecord(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function strictCompletionBody(req: Request): Record<string, unknown> {
  const body = bodyRecord(req);
  const keys = Object.keys(body);
  if (keys.length !== ACCEPTED_BODY_KEYS.size || keys.some((key) => !ACCEPTED_BODY_KEYS.has(key))) {
    throw new WhatsAppConnectionCompletionValidationError();
  }
  return body;
}

export class WhatsAppConnectionController {
  constructor(private readonly completionService: EmbeddedSignupCompletionService) {}

  completeEmbeddedSignup = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      const body = strictCompletionBody(req);
      const result = await this.completionService.complete(authorized.tenant, {
        code: body.code as string,
        wabaId: body.wabaId as string,
        phoneNumberId: body.phoneNumberId as string,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };
}
