import type { Request, Response } from "express";
import type { AuthorizedRequest } from "../../auth/http/auth-request.types";
import type { EmbeddedSignupCompletionService } from "../application/embedded-signup-completion.service";
import type { ManualConnectionAssetsService } from "../application/manual-connection-assets.service";
import type { ManualConnectionSetupService } from "../application/manual-connection-setup.service";
import type { WhatsAppConnectionCurrentService } from "../application/whatsapp-connection-current.service";
import type { WhatsAppConnectionDisconnectService } from "../application/whatsapp-connection-disconnect.service";
import type { WhatsAppConnectionFinalizationService } from "../application/whatsapp-connection-finalization.service";
import { WhatsAppConnectionCompletionValidationError, WhatsAppConnectionCredentialEncryptionError, WhatsAppConnectionDisconnectValidationError } from "../domain/whatsapp-connection.errors";
import { sendWhatsappConnectionError } from "./whatsapp-connection-http.errors";

const ACCEPTED_BODY_KEYS = new Set(["code", "wabaId", "phoneNumberId"]);
const MANUAL_SETUP_BODY_KEYS = new Set(["appId", "appSecret", "systemUserAccessToken"]);
const MANUAL_SELECT_ASSETS_BODY_KEYS = new Set(["wabaId", "phoneNumberId"]);

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

function strictManualSetupBody(req: Request): Record<string, unknown> {
  const body = bodyRecord(req);
  const keys = Object.keys(body);
  if (keys.length !== MANUAL_SETUP_BODY_KEYS.size || keys.some((key) => !MANUAL_SETUP_BODY_KEYS.has(key))) {
    throw new WhatsAppConnectionCompletionValidationError();
  }
  return body;
}

function strictEmptyBody(req: Request): void {
  if (Object.keys(bodyRecord(req)).length !== 0) throw new WhatsAppConnectionCompletionValidationError();
}

function strictManualSelectAssetsBody(req: Request): Record<string, unknown> {
  const body = bodyRecord(req);
  const keys = Object.keys(body);
  if (keys.length !== MANUAL_SELECT_ASSETS_BODY_KEYS.size || keys.some((key) => !MANUAL_SELECT_ASSETS_BODY_KEYS.has(key))) {
    throw new WhatsAppConnectionCompletionValidationError();
  }
  return body;
}

export class WhatsAppConnectionController {
  constructor(
    private readonly completionService: EmbeddedSignupCompletionService,
    private readonly currentService?: WhatsAppConnectionCurrentService,
    private readonly finalizationService?: WhatsAppConnectionFinalizationService,
    private readonly disconnectService?: WhatsAppConnectionDisconnectService,
    private readonly manualSetupService?: ManualConnectionSetupService,
    private readonly manualAssetsService?: ManualConnectionAssetsService,
  ) {}

  getCurrentConnection = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!this.currentService) throw new WhatsAppConnectionCompletionValidationError();
      const authorized = req as AuthorizedRequest;
      const result = await this.currentService.getCurrent(authorized.tenant);
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };

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

  setupManualConnection = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!this.manualSetupService) throw new WhatsAppConnectionCredentialEncryptionError();
      const authorized = req as AuthorizedRequest;
      const body = strictManualSetupBody(req);
      const result = await this.manualSetupService.setup(authorized.tenant, {
        appId: body.appId as string,
        appSecret: body.appSecret as string,
        systemUserAccessToken: body.systemUserAccessToken as string,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };

  discoverManualAssets = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!this.manualAssetsService) throw new WhatsAppConnectionCredentialEncryptionError();
      strictEmptyBody(req);
      const authorized = req as AuthorizedRequest;
      const connectionId = typeof req.params.connectionId === "string" ? req.params.connectionId : "";
      const result = await this.manualAssetsService.discover(authorized.tenant, connectionId);
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };

  selectManualAssets = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!this.manualAssetsService) throw new WhatsAppConnectionCredentialEncryptionError();
      const authorized = req as AuthorizedRequest;
      const connectionId = typeof req.params.connectionId === "string" ? req.params.connectionId : "";
      const body = strictManualSelectAssetsBody(req);
      const result = await this.manualAssetsService.selectAssets(authorized.tenant, connectionId, {
        wabaId: body.wabaId as string,
        phoneNumberId: body.phoneNumberId as string,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };

  finalizeConnection = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!this.finalizationService) throw new WhatsAppConnectionCompletionValidationError();
      const authorized = req as AuthorizedRequest;
      if (Object.keys(bodyRecord(req)).length !== 0) throw new WhatsAppConnectionCompletionValidationError();
      const connectionId = typeof req.params.connectionId === "string" ? req.params.connectionId : "";
      const result = await this.finalizationService.finalize(authorized.tenant, connectionId);
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };

  disconnectConnection = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!this.disconnectService) throw new WhatsAppConnectionDisconnectValidationError();
      const authorized = req as AuthorizedRequest;
      if (Object.keys(bodyRecord(req)).length !== 0) throw new WhatsAppConnectionDisconnectValidationError();
      const connectionId = typeof req.params.connectionId === "string" ? req.params.connectionId : "";
      const result = await this.disconnectService.disconnect(authorized.tenant, connectionId);
      return res.status(200).json(result);
    } catch (error) {
      return sendWhatsappConnectionError(res, error);
    }
  };
}
