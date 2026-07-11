export interface ProductImage {
  url?: string;
  localPath?: string;
  caption?: string;
  color?: string;
}

export interface ProductContext {
  businessName: string;
  productId?: string;
  productName: string;
  category?: string;
  description?: string;
  price?: string;
  currency?: string;
  availableColors?: string[];
  availableSizes?: string[];
  variants?: string[];
  features?: string[];
  deliveryInfo?: string;
  deliveryPrice?: number;
  deliveryIsFree?: boolean;
  deliveryAreas?: string[];
  deliveryTime?: string;
  paymentMethods?: string[];
  offer?: string;
  stockInfo?: string;
  warrantyInfo?: string;
  condition?: string;
  attributes?: Record<string, string>;
  faqs?: Array<{ question: string; answer: string }>;
  unavailableProducts?: string[];
  recommendationNotes?: string[];
  images?: ProductImage[];
  requiredOrderFields?: string[];
  extraNotes?: string[];
}
