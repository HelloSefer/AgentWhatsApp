import type { ProductAvailability } from "./product-contracts";
export type ProductValueForm = { valueId: string; label: string; isAvailable: boolean };
export type ProductOptionForm = { optionId: string; label: string; required: boolean; values: ProductValueForm[] };
export type ProductOfferForm = { offerId: string; label: string; requiredItemCount: string; totalMad: string; active: boolean; allowMixedOptions: boolean; priority: string; startsAt: string; endsAt: string };
export type ProductFormState = { name: string; description: string; priceMad: string; availability: ProductAvailability; options: ProductOptionForm[]; aliases: string[]; offers: ProductOfferForm[] };
