export type CatalogOptionValue = Readonly<{
  valueId: string;
  label: string;
  position: number;
  isAvailable: boolean;
}>;

export type CatalogOption = Readonly<{
  optionId: string;
  label: string;
  required: boolean;
  position: number;
  values: readonly CatalogOptionValue[];
}>;
