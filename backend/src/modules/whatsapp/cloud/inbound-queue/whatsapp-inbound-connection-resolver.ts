/**
 * The worker deliberately resolves the exact connection trusted by the
 * webhook phone number. Credentials are local runtime data and never appear
 * in the queue job contract.
 */
export type WhatsAppInboundConnectionResolver = Readonly<{
  resolveForTrustedInbound: (input: Readonly<{ sellerId: string; phoneNumberId: string }>) => Promise<Readonly<{
    sellerId: string;
    connectionId: string;
    phoneNumberId: string;
    accessToken: string;
    tokenSource?: "encrypted_connection_token";
  }>>;
}>;
