import type { Request, Response } from "express";
import type { AuthorizedRequest } from "../../auth/http/auth-request.types";
import type { CatalogService } from "../application/catalog.service";
import { toCatalogProductResponse } from "./catalog-product.dto";
import { sendCatalogProductError } from "./catalog-product-http.errors";
import { parseCatalogProductAvailability, parseCatalogProductCreate, parseCatalogProductPath, parseCatalogProductQuery, parseCatalogProductReplace } from "./catalog-product-request.parser";

export class CatalogProductController {
  constructor(private readonly service: CatalogService) {}

  list = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      const result = await this.service.listProducts(authorized.tenant, parseCatalogProductQuery(req.query));
      return res.status(200).json({ products: result.products.map(toCatalogProductResponse), ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }) });
    } catch (error) { return sendCatalogProductError(res, error); }
  };

  read = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      const product = await this.service.getProduct(authorized.tenant, parseCatalogProductPath(req.params.productId));
      if (!product) return res.status(404).json({ message: "Product not found." });
      return res.status(200).json(toCatalogProductResponse(product));
    } catch (error) { return sendCatalogProductError(res, error); }
  };

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const product = await this.service.createProduct((req as AuthorizedRequest).tenant, parseCatalogProductCreate(req.body));
      return res.status(201).json(toCatalogProductResponse(product));
    } catch (error) { return sendCatalogProductError(res, error); }
  };

  replace = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      const productId = parseCatalogProductPath(req.params.productId);
      const existing = await this.service.getProduct(authorized.tenant, productId);
      if (!existing) return res.status(404).json({ message: "Product not found." });
      const replacement = parseCatalogProductReplace(req.body, productId);
      const product = await this.service.replaceProduct(authorized.tenant, { ...replacement, images: existing.images });
      return res.status(200).json(toCatalogProductResponse(product));
    } catch (error) { return sendCatalogProductError(res, error); }
  };

  availability = async (req: Request, res: Response): Promise<Response> => {
    try {
      const authorized = req as AuthorizedRequest;
      const product = await this.service.setProductAvailability(authorized.tenant, parseCatalogProductPath(req.params.productId), parseCatalogProductAvailability(req.body));
      return res.status(200).json(toCatalogProductResponse(product));
    } catch (error) { return sendCatalogProductError(res, error); }
  };
}
