import type { Request, Response } from "express";
import { normalizeSellerConfig } from "./first-entry-config.service";
import { renderFirstEntryMessage } from "./first-entry-renderer.service";
import { productContextService } from "./product-context.service";
import { requiredFieldsService } from "./required-fields.service";
import { sellerConfigService } from "./seller-config.service";

function getSellerId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getAgentConfig(req: Request, res: Response) {
  const sellerId = getSellerId(req.params.sellerId);
  const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
  const productResult =
    productContextService.getActiveProductContextWithMeta(sellerId);
  const sellerConfig = normalizeSellerConfig(
    sellerResult.sellerConfig,
    productResult.productContext.price,
  );
  const requiredOrderFields = requiredFieldsService.getRequiredOrderFields({
    sellerConfig,
    productContext: productResult.productContext,
  });

  return res.status(200).json({
    sellerId: sellerConfig.sellerId,
    requestedSellerId: sellerId,
    fallbackUsed: sellerResult.fallbackUsed || productResult.fallbackUsed,
    sellerConfig,
    productContext: productResult.productContext,
    requiredOrderFields,
    requiredOrderFieldKeys: requiredOrderFields.map((field) => field.key),
  });
}

export function getAgentRequiredFields(req: Request, res: Response) {
  const sellerId = getSellerId(req.params.sellerId);
  const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
  const productResult =
    productContextService.getActiveProductContextWithMeta(sellerId);
  const sellerConfig = normalizeSellerConfig(
    sellerResult.sellerConfig,
    productResult.productContext.price,
  );
  const requiredOrderFields = requiredFieldsService.getRequiredOrderFields({
    sellerConfig,
    productContext: productResult.productContext,
  });

  return res.status(200).json({
    sellerId: sellerConfig.sellerId,
    requestedSellerId: sellerId,
    fallbackUsed: sellerResult.fallbackUsed || productResult.fallbackUsed,
    requiredOrderFields,
    requiredOrderFieldKeys: requiredOrderFields.map((field) => field.key),
  });
}

export function getAgentFirstEntryPreview(req: Request, res: Response) {
  const sellerId = getSellerId(req.params.sellerId);
  const sellerResult = sellerConfigService.getSellerConfigWithMeta(sellerId);
  const productResult =
    productContextService.getActiveProductContextWithMeta(sellerId);
  const sellerConfig = normalizeSellerConfig(
    sellerResult.sellerConfig,
    productResult.productContext.price,
  );
  const result = renderFirstEntryMessage({
    sellerConfig,
    productContext: productResult.productContext,
  });

  return res.status(200).json({
    ok: true,
    previewOnly: true,
    sellerId: sellerConfig.sellerId,
    requestedSellerId: sellerId,
    fallbackUsed: sellerResult.fallbackUsed || productResult.fallbackUsed,
    productId: productResult.productContext.productId,
    result,
  });
}
