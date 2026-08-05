export function minorToMadInput(value: number | undefined): string {
  if (value === undefined) return "";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const major = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  return `${sign}${major}.${cents}`;
}

export function madInputToMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) return null;
  const [majorRaw, centsRaw = ""] = normalized.split(".");
  const major = Number(majorRaw);
  const cents = Number(centsRaw.padEnd(2, "0"));
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(cents)) return null;
  const minor = (major * 100) + cents;
  return Number.isSafeInteger(minor) ? minor : null;
}
