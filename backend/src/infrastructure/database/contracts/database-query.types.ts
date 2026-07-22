export type DatabaseQueryParameter = unknown;

export type ParameterizedQuery = Readonly<{
  text: string;
  values?: readonly DatabaseQueryParameter[];
}>;

export type DatabaseQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = Readonly<{
  rows: readonly Row[];
  rowCount: number;
}>;

export interface DatabaseQueryExecutor {
  execute<Row extends Record<string, unknown> = Record<string, unknown>>(
    query: ParameterizedQuery,
  ): Promise<DatabaseQueryResult<Row>>;
}

export interface DatabaseTransactionExecutor extends DatabaseQueryExecutor {}
