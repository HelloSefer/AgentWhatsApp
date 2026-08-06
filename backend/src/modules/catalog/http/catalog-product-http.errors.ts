import type { Response } from "express";
import { CatalogPersistenceError, CatalogSellerNotFoundError, CatalogValidationError, ProductAliasAlreadyExistsError, ProductAlreadyExistsError, ProductNotFoundError } from "../domain/catalog.errors";
import { CatalogProductHttpValidationError } from "./catalog-product-request.parser";

export function sendCatalogProductError(res: Response, error: unknown): Response {
  if (error instanceof CatalogProductHttpValidationError) return res.status(400).json({ message: "Invalid product request.", errors: error.issues });
  if (error instanceof CatalogValidationError) return res.status(422).json({ message: "Product failed Catalog validation.", errors: [{ field: "body", code: "CATALOG_VALIDATION_FAILED" }] });
  if (error instanceof ProductNotFoundError || error instanceof CatalogSellerNotFoundError) return res.status(404).json({ message: "Product not found." });
  if (error instanceof ProductAlreadyExistsError) return res.status(409).json({ message: "Product already exists.", errors: [{ field: "productId", code: "DUPLICATE_PRODUCT_ID" }] });
  if (error instanceof ProductAliasAlreadyExistsError) return res.status(409).json({ message: "Product alias already exists.", errors: [{ field: "aliases", code: "ALIAS_ALREADY_EXISTS" }] });
  if (error instanceof CatalogPersistenceError) return res.status(500).json({ message: "Product service unavailable." });
  return res.status(500).json({ message: "Product service unavailable." });
}
