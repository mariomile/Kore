import { createDb, type Database } from '@reflect/db'
import type { Kysely } from 'kysely'
import { toAppError } from '../errors'
import { getBridge } from '../ipc/bridge'

/**
 * One compiled read to run through the `db_query` / `db_query_batch` bridge.
 * `sql` is bound, never interpolated — the same contract as Kysely's runner.
 */
export interface CompiledReadQuery {
  readonly sql: string
  readonly params: readonly unknown[]
}

/**
 * The shared Kysely instance over the active graph's SQLite index. Queries
 * compile in TypeScript and execute in Rust via the `db_query` command.
 *
 * The runner resolves the bridge per query (not at module load), so this
 * instance is safe to create before {@link setBridge} runs — only executing a
 * query without a bridge throws. Rejections are coerced to the shared
 * {@link AppError} contract like every other command.
 */
export const db: Kysely<Database> = createDb(async (sql, params) => {
  try {
    return await getBridge().invoke('db_query', { sql, params: [...params] })
  } catch (error) {
    throw toAppError(error)
  }
})

/**
 * Run many read queries on the **same** index connection in one IPC hop.
 * Related-notes KNN issues one MATCH per seed vector; sending them together
 * keeps the sidebar refetch off a fan-out of `db_query` round-trips. An empty
 * list is a no-op (no IPC). The payload must be an array of row arrays.
 */
export async function queryBatch<R>(queries: readonly CompiledReadQuery[]): Promise<R[][]> {
  if (queries.length === 0) {
    return []
  }
  try {
    const rows = await getBridge().invoke('db_query_batch', {
      queries: queries.map((query) => ({ sql: query.sql, params: [...query.params] })),
    })
    if (!Array.isArray(rows) || rows.some((entry) => !Array.isArray(entry))) {
      throw new TypeError('db_query_batch did not return an array of row arrays')
    }
    return rows as R[][]
  } catch (error) {
    throw toAppError(error)
  }
}
