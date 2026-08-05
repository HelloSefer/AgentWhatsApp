import type { Request, Response } from "express";
import type { AuthorizedRequest } from "../../auth/http/auth-request.types";
import { parseSellerSettingsUpdate } from "../application/seller-settings.validation";
import type { SellerSettingsService } from "../application/seller-settings.service";
import { recordSellerSettingsAudit } from "../application/seller-settings-operational-events";
import { SellerSettingsForbiddenRoleError, SellerSettingsValidationError } from "../application/seller-settings.types";
import { sendSellerSettingsError } from "./seller-settings-http.errors";

function assertOwnerOrAdmin(req: AuthorizedRequest): asserts req is AuthorizedRequest & Readonly<{ authorization: { role: "OWNER" | "ADMIN" } }> {
  if (req.authorization.role !== "OWNER" && req.authorization.role !== "ADMIN") {
    recordSellerSettingsAudit("seller_settings.authorization_failed", {
      role: req.authorization.role,
      result: "forbidden",
    });
    throw new SellerSettingsForbiddenRoleError();
  }
}

export class SellerSettingsController {
  constructor(private readonly service: SellerSettingsService) {}

  read = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      assertOwnerOrAdmin(authorized);
      return res.status(200).json(await this.service.read(authorized.tenant));
    } catch (error) {
      return sendSellerSettingsError(res, error);
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      assertOwnerOrAdmin(authorized);
      const input = parseSellerSettingsUpdate(req.body, authorized.tenant.sellerId);
      const result = await this.service.update(authorized.tenant, input, { role: authorized.authorization.role });
      return res.status(200).json(result.settings);
    } catch (error) {
      if (error instanceof SellerSettingsValidationError) {
        recordSellerSettingsAudit("seller_settings.validation_failed", {
          role: (req as Partial<AuthorizedRequest>).authorization?.role,
          result: "invalid_request",
          issueCodes: error.issues.map((issue) => issue.code),
        });
      }
      return sendSellerSettingsError(res, error);
    }
  };
}
