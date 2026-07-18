import type { RequiredOrderField } from "../config/required-fields.types";

export type SupportedOrderFieldValue = string | number | boolean;

export type CartMode = "STANDARD" | "OFFER";

export const cartStatuses = [
  "EMPTY",
  "PLANNING",
  "COLLECTING_ITEM",
  "CART_REVIEW",
  "COLLECTING_DELIVERY",
  "AWAITING_CONFIRMATION",
  "CONFIRMED",
  "CANCELLED",
] as const;

export type CartStatus = (typeof cartStatuses)[number];

export type CartItemStatus = "DRAFT" | "COMPLETE";

export type CartItem = {
  id: string;
  productId: string;
  quantity: number;
  /** A draft may carry the safe internal default of 1 before the customer has selected a quantity. */
  quantityExplicitlySet?: boolean;
  selectedOptions: Record<string, SupportedOrderFieldValue>;
  status: CartItemStatus;
};

export type CartDraft = {
  schemaVersion: 1;
  mode: CartMode;
  status: CartStatus;
  targetItemCount?: number;
  selectedOfferId?: string;
  items: CartItem[];
  currentItemDraft?: CartItem;
  orderLevelFields: Record<string, SupportedOrderFieldValue>;
};

export type CartFieldScope = "ITEM" | "ORDER";

export type CartIntegrityResult = {
  valid: boolean;
  invalidPaths: string[];
  warnings: string[];
};

export type CartMutationResult = {
  cart: CartDraft;
  accepted: boolean;
  invalidPaths?: string[];
  mergedItemId?: string;
};

export type CartCompatibilityInput = {
  cart?: CartDraft;
  legacyCollected: Record<string, unknown>;
  legacyState: {
    orderCycleId?: string;
    isComplete: boolean;
    awaitingConfirmation: boolean;
    confirmed: boolean;
  };
  productId?: string;
  fields: RequiredOrderField[];
};

export type CartCompatibilityResult = {
  cart: CartDraft;
  collected: Record<string, SupportedOrderFieldValue>;
  integrity: CartIntegrityResult;
  migrated: boolean;
  changed: boolean;
};
