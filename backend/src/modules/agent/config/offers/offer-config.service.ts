import { productContextService } from "../product-context.service";
import type { ProductContext } from "../product-context.types";
import type {
  ProductOfferConfig,
  ProductOfferConfigurationState,
  ProductOfferConfigValidationResult,
} from "./offer.types";
import { validateAndNormalizeProductOffers } from "./offer-config.validator";

export type ProductOfferLookupResult = {
  state: ProductOfferConfigurationState;
  sellerId: string;
  productId: string;
  offers: ProductOfferConfig[];
  activeOffers: ProductOfferConfig[];
  validation: ProductOfferConfigValidationResult;
};

type ProductOfferLookupInput = {
  sellerId: string;
  productId: string;
  /** Test-only injection keeps lookup deterministic without a mutable registry. */
  productContexts?: readonly ProductContext[];
};

function emptyValidation(): ProductOfferConfigValidationResult {
  return {
    valid: true,
    normalizedOffers: [],
    errors: [],
    warnings: [],
  };
}

function cloneOffer(offer: ProductOfferConfig): ProductOfferConfig {
  return { ...offer };
}

/**
 * Read-only seller/product-scoped offer access. It does not determine
 * eligibility, calculate totals, or write any cart or session state.
 */
export class OfferConfigService {
  getConfiguredOffers(input: ProductOfferLookupInput): ProductOfferLookupResult {
    const sellerId = input.sellerId.trim();
    const productId = input.productId.trim();
    const productContexts = input.productContexts || productContextService.listDemoProductContexts();
    const productContext = productContexts.find(
      (context) => context.sellerId === sellerId && context.productId === productId,
    );

    if (!productContext) {
      return {
        state: "PRODUCT_NOT_FOUND",
        sellerId,
        productId,
        offers: [],
        activeOffers: [],
        validation: emptyValidation(),
      };
    }

    const validation = validateAndNormalizeProductOffers({
      productId: productContext.productId,
      currency: productContext.currency,
      offers: productContext.offers,
    });

    if (!validation.valid) {
      return {
        state: "INVALID_CONFIGURATION",
        sellerId,
        productId,
        offers: [],
        activeOffers: [],
        validation,
      };
    }

    const offers = validation.normalizedOffers.map(cloneOffer);
    const activeOffers = offers.filter((offer) => offer.active).map(cloneOffer);
    const state: ProductOfferConfigurationState = offers.length === 0
      ? "NO_OFFERS_CONFIGURED"
      : activeOffers.length === 0
        ? "OFFERS_CONFIGURED_BUT_INACTIVE"
        : "OFFERS_CONFIGURED";

    return {
      state,
      sellerId,
      productId,
      offers,
      activeOffers,
      validation,
    };
  }

  getActiveConfiguredOffers(input: ProductOfferLookupInput): ProductOfferLookupResult {
    const lookup = this.getConfiguredOffers(input);

    return {
      ...lookup,
      offers: lookup.activeOffers.map(cloneOffer),
      activeOffers: lookup.activeOffers.map(cloneOffer),
    };
  }

  findConfiguredOfferById(input: ProductOfferLookupInput & { offerId: string }): ProductOfferLookupResult & {
    offer?: ProductOfferConfig;
  } {
    const lookup = this.getConfiguredOffers(input);
    const offerId = input.offerId.trim();

    return {
      ...lookup,
      offer: lookup.offers.find((offer) => offer.id === offerId),
    };
  }
}

export const offerConfigService = new OfferConfigService();
