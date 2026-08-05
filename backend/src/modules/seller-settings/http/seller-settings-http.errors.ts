import type { Response } from "express";
import { SellerCommerceConfigValidationError } from "../../seller-commerce-config/seller-commerce-config.types";
import { SellerWorkspaceProfilePersistenceError, SellerWorkspaceProfileValidationError } from "../../seller-workspace-profile";
import {
  SellerSettingsForbiddenRoleError,
  SellerSettingsProfileRequiredError,
  SellerSettingsValidationError,
} from "../application/seller-settings.types";

export function sendSellerSettingsError(res: Response, error: unknown): Response {
  if (error instanceof SellerSettingsForbiddenRoleError) {
    return res.status(403).json({ message: "Forbidden." });
  }
  if (error instanceof SellerSettingsValidationError) {
    return res.status(400).json({
      message: "Invalid seller settings request.",
      errors: error.issues,
    });
  }
  if (error instanceof SellerWorkspaceProfileValidationError || error instanceof SellerCommerceConfigValidationError) {
    return res.status(422).json({ message: "Seller settings failed domain validation." });
  }
  if (error instanceof SellerSettingsProfileRequiredError) {
    return res.status(404).json({ message: "Seller settings unavailable." });
  }
  if (error instanceof SellerWorkspaceProfilePersistenceError) {
    return res.status(500).json({ message: "Seller settings persistence failed." });
  }
  return res.status(500).json({ message: "Seller settings service unavailable." });
}
