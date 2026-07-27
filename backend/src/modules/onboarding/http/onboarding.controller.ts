import type { Request, Response } from "express";
import type { AuthRepositories } from "../../auth";
import type { AuthenticatedRequest, AuthorizedRequest } from "../../auth/http/auth-request.types";
import type { SellerLogoService, SellerLogoMetadata } from "../../seller-logo";
import type { SellerWorkspaceProfileRepository, SellerWorkspaceProfile } from "../../seller-workspace-profile";
import type { SellerWorkspaceOnboardingService } from "../../seller-workspace-onboarding";
import { SellerWorkspaceOnboardingInconsistentStateError } from "../../seller-workspace-onboarding";
import { sendOnboardingError } from "./onboarding-http.errors";
import type { MultipartImageRequest } from "./multipart-image.middleware";

type WorkspaceSummary = Readonly<{
  sellerId: string;
  displayName: string;
  intendedWhatsAppPhone?: string;
  logo?: SellerLogoMetadata;
  role: string;
  whatsappStatus: "NOT_CONNECTED";
}>;

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function logo(profile: SellerWorkspaceProfile): SellerLogoMetadata | undefined {
  if (!profile.logoObjectKey || !profile.logoMimeType) return undefined;
  if (!["image/png", "image/jpeg", "image/webp"].includes(profile.logoMimeType)) return undefined;
  return {
    objectKey: profile.logoObjectKey,
    mimeType: profile.logoMimeType as SellerLogoMetadata["mimeType"],
  };
}

function summary(profile: SellerWorkspaceProfile, role: string): WorkspaceSummary {
  return {
    sellerId: profile.sellerId,
    displayName: profile.displayName,
    intendedWhatsAppPhone: profile.intendedWhatsappPhoneE164,
    logo: logo(profile),
    role,
    whatsappStatus: "NOT_CONNECTED",
  };
}

function bodyRecord(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

export class OnboardingController {
  constructor(
    private readonly authRepository: AuthRepositories,
    private readonly profileRepository: SellerWorkspaceProfileRepository,
    private readonly onboardingService: SellerWorkspaceOnboardingService,
    private readonly logoService: SellerLogoService,
  ) {}

  status = async (req: Request, res: Response): Promise<Response> => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const activeMemberships = (await this.authRepository.listSellerMembershipsForUser(auth.userId))
        .filter((membership) => membership.status === "active");
      if (activeMemberships.length === 0) {
        return res.status(200).json({ needsOnboarding: true });
      }
      if (activeMemberships.length !== 1) throw new SellerWorkspaceOnboardingInconsistentStateError();
      const membership = activeMemberships[0];
      if (!membership) throw new SellerWorkspaceOnboardingInconsistentStateError();
      const profile = await this.profileRepository.findByTenantContext({ sellerId: membership.sellerId });
      if (!profile) throw new SellerWorkspaceOnboardingInconsistentStateError();
      return res.status(200).json({
        needsOnboarding: false,
        workspace: summary(profile, membership.role),
      });
    } catch (error) {
      return sendOnboardingError(res, error);
    }
  };

  createWorkspace = async (req: Request, res: Response): Promise<Response> => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const body = bodyRecord(req);
      const result = await this.onboardingService.createWorkspace({
        userId: auth.userId,
        storeName: body.storeName as string,
        intendedWhatsAppPhone: stringField(body.intendedWhatsAppPhone),
      });
      return res.status(result.status === "created" ? 201 : 200).json({
        status: result.status,
        needsOnboarding: false,
        workspace: summary(result.profile, result.ownerMembership.role),
      });
    } catch (error) {
      return sendOnboardingError(res, error);
    }
  };

  uploadLogo = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest & MultipartImageRequest;
      const image = authorized.uploadedImage;
      if (!image) throw new SellerWorkspaceOnboardingInconsistentStateError();
      const metadata = await this.logoService.uploadOrReplaceLogo(authorized.tenant, image.bytes, image.mimeType);
      return res.status(200).json({ logo: metadata, whatsappStatus: "NOT_CONNECTED" });
    } catch (error) {
      return sendOnboardingError(res, error);
    }
  };

  deleteLogo = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      await this.logoService.removeLogo(authorized.tenant);
      return res.status(200).json({ logo: null, whatsappStatus: "NOT_CONNECTED" });
    } catch (error) {
      return sendOnboardingError(res, error);
    }
  };
}
