export const DEFAULT_DEMO_SELLER_ID = "seller_demo_sandals";

const sellerByPhoneNumberId: Record<string, string> = {
  "1168457439687919": DEFAULT_DEMO_SELLER_ID,
  "222222222222222": "seller_demo_medical",
};

export class SellerResolverService {
  resolveSellerIdByPhoneNumberId(phoneNumberId: string): string {
    const cleanPhoneNumberId = phoneNumberId.trim();

    if (!cleanPhoneNumberId) {
      return DEFAULT_DEMO_SELLER_ID;
    }

    return sellerByPhoneNumberId[cleanPhoneNumberId] || DEFAULT_DEMO_SELLER_ID;
  }

  isKnownPhoneNumberId(phoneNumberId: string): boolean {
    return Boolean(sellerByPhoneNumberId[phoneNumberId.trim()]);
  }
}

export const sellerResolverService = new SellerResolverService();

