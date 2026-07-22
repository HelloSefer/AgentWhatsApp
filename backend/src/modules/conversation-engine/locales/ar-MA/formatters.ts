const itemOrdinals = [
  "الأولى",
  "الثانية",
  "الثالثة",
  "الرابعة",
  "الخامسة",
  "السادسة",
  "السابعة",
  "الثامنة",
  "التاسعة",
  "العاشرة",
] as const;

export function arMaItemOrdinal(index: number): string {
  return itemOrdinals[index] || `رقم ${index + 1}`;
}

export function arMaItemReference(index: number): string {
  const ordinal = itemOrdinals[index];
  return ordinal ? ordinal.replace(/^ال/u, "لل") : `للقطعة رقم ${index + 1}`;
}

export function arMaConjunctionList(values: readonly string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join(" و");
}
