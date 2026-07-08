export class ConversationKeyService {
  buildConversationKey(sellerId: string, customerPhone: string): string {
    const cleanSellerId = sellerId.trim();
    const cleanCustomerPhone = customerPhone.trim();

    if (!cleanSellerId) {
      throw new Error("sellerId is required to build conversation key");
    }

    if (!cleanCustomerPhone) {
      throw new Error("customerPhone is required to build conversation key");
    }

    return `${cleanSellerId}:${cleanCustomerPhone}`;
  }

  buildSessionKey(conversationKey: string): string {
    return `session:${conversationKey.trim()}`;
  }

  buildBufferKey(conversationKey: string): string {
    return `buffer:${conversationKey.trim()}`;
  }

  buildLockKey(conversationKey: string): string {
    return `lock:${conversationKey.trim()}`;
  }
}

export const conversationKeyService = new ConversationKeyService();

