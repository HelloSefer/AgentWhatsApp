import { DEFAULT_DEMO_SELLER_ID } from "../identity/seller-resolver.service";
import { demoProductContexts } from "./demo-product-contexts";
import type { ProductContext } from "./product-context.types";

export type ProductContextLookupResult = {
  productContext: ProductContext;
  requestedSellerId: string;
  fallbackUsed: boolean;
};

export class ProductContextService {
  getActiveProductContext(sellerId: string): ProductContext {
    return this.getActiveProductContextWithMeta(sellerId).productContext;
  }

  getActiveProductContextWithMeta(sellerId: string): ProductContextLookupResult {
    const cleanSellerId = sellerId.trim();
    const productContext = demoProductContexts.find(
      (context) => context.sellerId === cleanSellerId && context.active,
    );

    if (productContext) {
      return {
        productContext,
        requestedSellerId: cleanSellerId,
        fallbackUsed: false,
      };
    }

    console.warn(
      `⚠️ Product context not found for ${cleanSellerId || "(empty)"}, using ${DEFAULT_DEMO_SELLER_ID}`,
    );

    return {
      productContext:
        demoProductContexts.find(
          (context) =>
            context.sellerId === DEFAULT_DEMO_SELLER_ID && context.active,
        ) || demoProductContexts[0],
      requestedSellerId: cleanSellerId,
      fallbackUsed: true,
    };
  }

  listDemoProductContexts(): ProductContext[] {
    return [...demoProductContexts];
  }

  getProductContextById(productId: string): ProductContext | undefined {
    const cleanProductId = productId.trim();

    return demoProductContexts.find(
      (context) => context.productId === cleanProductId,
    );
  }
}

export const productContextService = new ProductContextService();
