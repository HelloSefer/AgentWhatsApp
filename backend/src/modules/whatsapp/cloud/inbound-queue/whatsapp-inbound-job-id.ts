import { buildDeterministicJobId, type DeterministicJobId } from "../../../../infrastructure/queue";

export function buildWhatsAppInboundJobId(sellerId: string, messageId: string): DeterministicJobId {
  return buildDeterministicJobId(["whatsapp-inbound", sellerId, messageId]);
}
