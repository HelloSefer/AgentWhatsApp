import type { PremiumReceiptItem } from "./premium-order-receipt.types";

export type PremiumReceiptProductGroup = Readonly<{
  groupKey: string;
  productName: string;
  imageRef?: string;
  variants: readonly PremiumReceiptItem[];
}>;

/**
 * Groups only lines carrying the same stable opaque identity. Lines without a
 * stable identity remain separate, so a matching display name is never enough
 * to combine distinct products.
 */
export function groupPremiumReceiptItems(
  lines: readonly PremiumReceiptItem[],
): readonly PremiumReceiptProductGroup[] {
  const groups = new Map<
    string,
    {
      groupKey: string;
      productName: string;
      imageRef?: string;
      variants: PremiumReceiptItem[];
    }
  >();

  lines.forEach((line, index) => {
    const stableKey = line.productGroupKey?.trim();
    const groupKey = stableKey ? `stable:${stableKey}` : `line:${index}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.variants.push(line);
      if (!existing.imageRef && line.imageRef) existing.imageRef = line.imageRef;
      return;
    }

    groups.set(groupKey, {
      groupKey,
      productName: line.productName,
      ...(line.imageRef ? { imageRef: line.imageRef } : {}),
      variants: [line],
    });
  });

  return Array.from(groups.values(), (group) =>
    Object.freeze({
      ...group,
      variants: Object.freeze([...group.variants]),
    }),
  );
}
