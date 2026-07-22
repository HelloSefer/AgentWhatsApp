export type DatabaseMigration = Readonly<{
  id: string;
  filename: string;
  path: string;
  sql: string;
}>;

export type MigrationStatus = Readonly<{
  metadataReady: boolean;
  applied: readonly string[];
  pending: readonly string[];
}>;

export type MigrationRunResult = Readonly<{
  applied: readonly string[];
  pending: readonly string[];
}>;
