export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeComparable(text: string): string {
  return normalizeText(text).replace(/^ال/, "");
}

export function includesAny(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) =>
    normalizeText(message).includes(normalizeText(keyword)),
  );
}

export function formatNaturalList(items: string[]): string {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);

  if (cleanItems.length <= 1) {
    return cleanItems.join("");
  }

  return `${cleanItems.slice(0, -1).join("، ")} و${
    cleanItems[cleanItems.length - 1]
  }`;
}
