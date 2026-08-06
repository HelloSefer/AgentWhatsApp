export { madInputToMinor, minorToMadInput } from "@/features/seller-settings/utils/seller-settings-money";
export function formatMad(minor: number): string { return new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100); }
