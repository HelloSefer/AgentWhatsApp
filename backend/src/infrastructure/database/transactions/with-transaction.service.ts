import type { DatabaseTransactionExecutor } from "../contracts/database-query.types";
import { acquireDatabaseClient } from "../client/database-pool.service";

export async function withTransaction<Result>(
  callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>,
): Promise<Result> {
  const lease = await acquireDatabaseClient();
  let began = false;

  try {
    await lease.executor.execute({ text: "BEGIN" });
    began = true;
    const result = await callback(lease.executor);
    await lease.executor.execute({ text: "COMMIT" });
    return result;
  } catch (error) {
    if (began) {
      try {
        await lease.executor.execute({ text: "ROLLBACK" });
      } catch (rollbackError) {
        if (error instanceof Error) {
          Object.defineProperty(error, "databaseRollbackFailure", {
            value: rollbackError,
            enumerable: false,
            configurable: true,
          });
        }
      }
    }
    throw error;
  } finally {
    lease.release();
  }
}
