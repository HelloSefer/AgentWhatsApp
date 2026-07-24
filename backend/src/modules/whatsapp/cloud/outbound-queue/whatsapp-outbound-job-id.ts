import { buildDeterministicJobId, type DeterministicJobId } from "../../../../infrastructure/queue";
import type { WhatsAppOutboundResponseGroup } from "./whatsapp-outbound-job.types";

export function buildWhatsAppOutboundJobId(group: Pick<
  WhatsAppOutboundResponseGroup,
  "sellerId" | "source" | "responseGroupRole"
>): DeterministicJobId {
  return buildDeterministicJobId([
    "whatsapp-outbound",
    group.sellerId,
    group.source.type,
    group.source.id,
    group.responseGroupRole,
  ]);
}
