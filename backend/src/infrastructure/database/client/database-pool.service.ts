import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getDatabaseConfiguration } from "../config/database-config.service";
import type {
  DatabaseQueryExecutor,
  DatabaseQueryResult,
  ParameterizedQuery,
} from "../contracts/database-query.types";
import {
  DatabaseConnectionError,
  DatabaseQueryError,
  isDatabaseInfrastructureError,
} from "../errors/database.errors";

export type DatabasePoolState = Readonly<{
  initialized: boolean;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}>;

export type DatabaseClientLease = Readonly<{
  executor: DatabaseQueryExecutor;
  release: () => void;
}>;

let pool: Pool | undefined;
let closePromise: Promise<void> | undefined;

function mapResult<Row extends Record<string, unknown>>(result: QueryResult<QueryResultRow>): DatabaseQueryResult<Row> {
  return {
    rows: result.rows as unknown as readonly Row[],
    rowCount: result.rowCount || 0,
  };
}

async function executeWithClient<Row extends Record<string, unknown>>(
  client: Pick<PoolClient, "query">,
  query: ParameterizedQuery,
): Promise<DatabaseQueryResult<Row>> {
  try {
    const result = await client.query({
      text: query.text,
      values: query.values ? [...query.values] : undefined,
    });
    return mapResult<Row>(result);
  } catch (error) {
    if (isDatabaseInfrastructureError(error)) throw error;
    throw new DatabaseQueryError(error);
  }
}

export function getDatabasePool(): Pool {
  if (pool) return pool;

  const configuration = getDatabaseConfiguration();
  pool = new Pool({
    connectionString: configuration.connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export function getDatabasePoolState(): DatabasePoolState {
  return {
    initialized: Boolean(pool),
    totalCount: pool?.totalCount || 0,
    idleCount: pool?.idleCount || 0,
    waitingCount: pool?.waitingCount || 0,
  };
}

export async function executeDatabaseQuery<Row extends Record<string, unknown> = Record<string, unknown>>(
  query: ParameterizedQuery,
): Promise<DatabaseQueryResult<Row>> {
  const activePool = getDatabasePool();
  try {
    const result = await activePool.query({
      text: query.text,
      values: query.values ? [...query.values] : undefined,
    });
    return mapResult<Row>(result);
  } catch (error) {
    if (isDatabaseInfrastructureError(error)) throw error;
    throw new DatabaseQueryError(error);
  }
}

export async function acquireDatabaseClient(): Promise<DatabaseClientLease> {
  const activePool = getDatabasePool();
  let client: PoolClient;
  try {
    client = await activePool.connect();
  } catch (error) {
    throw new DatabaseConnectionError(error);
  }

  let released = false;
  return {
    executor: {
      execute: <Row extends Record<string, unknown> = Record<string, unknown>>(query: ParameterizedQuery) =>
        executeWithClient<Row>(client, query),
    },
    release: () => {
      if (released) return;
      released = true;
      client.release();
    },
  };
}

export async function closeDatabasePool(): Promise<void> {
  const activePool = pool;
  if (!activePool) return;
  if (closePromise) return closePromise;

  closePromise = activePool.end().finally(() => {
    if (pool === activePool) pool = undefined;
    closePromise = undefined;
  });
  return closePromise;
}
