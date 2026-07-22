import { CatalogValidationError } from "./catalog.errors";

export type Money = Readonly<{
  amountMinor: number;
  currencyCode: string;
}>;

export function validateMoney(value: unknown): Money {
  if (typeof value !== "object" || value === null) throw new CatalogValidationError();
  const candidate = value as { amountMinor?: unknown; currencyCode?: unknown };
  if (!Number.isSafeInteger(candidate.amountMinor) || (candidate.amountMinor as number) < 0) {
    throw new CatalogValidationError();
  }
  if (typeof candidate.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(candidate.currencyCode)) {
    throw new CatalogValidationError();
  }
  return { amountMinor: candidate.amountMinor as number, currencyCode: candidate.currencyCode };
}
