/**
 * `@kore/db` — the Kysely schema + the IPC query-builder dialect for the local
 * SQLite projection (Plan 04). SQLite runs in Rust; this package gives the
 * frontend typed, Kysely-built reads that execute over the `db_query` command.
 * Writes go through `@kore/core`'s `index_*` command bindings.
 *
 * The table/view types in `Database` are generated from the Rust migrations
 * (`pnpm --filter @kore/db db:codegen`); `schema.gen.ts` is the output.
 */
export { createDb } from './db'
export { IpcDialect, type QueryRunner } from './dialect'
export type { Database } from './schema'
