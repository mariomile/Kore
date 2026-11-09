import Database from 'better-sqlite3'

/**
 * Just enough of Cloudflare's D1 binding over an in-memory better-sqlite3
 * database (same SQLite, FTS5 included) for the store's tests: `prepare`,
 * `bind`, `first`, `all`, `run`, and `batch` as one transaction. D1's
 * numbered `?N` parameters become named ones, which better-sqlite3 binds by
 * name and lets a statement reuse.
 */
class FakeStatement {
  readonly #db: Database.Database
  readonly #sql: string
  readonly #params: unknown[]

  constructor(db: Database.Database, sql: string, params: unknown[] = []) {
    this.#db = db
    this.#sql = sql
    this.#params = params
  }

  bind(...params: unknown[]): FakeStatement {
    return new FakeStatement(this.#db, this.#sql, params)
  }

  #execute(): { results: Record<string, unknown>[]; changes: number } {
    const statement = this.#db.prepare(this.#sql.replaceAll(/\?(\d+)/g, '@p$1'))
    const named = Object.fromEntries(this.#params.map((value, index) => [`p${index + 1}`, value]))
    const args = this.#params.length === 0 ? [] : [named]
    if (statement.reader) {
      const results = statement.all(...args) as Record<string, unknown>[]
      return { results, changes: results.length }
    }
    const info = statement.run(...args)
    return { results: [], changes: info.changes }
  }

  async all(): Promise<{ results: unknown[]; success: true; meta: { changes: number } }> {
    const { results, changes } = this.#execute()
    return { results, success: true, meta: { changes } }
  }

  async run(): Promise<{ results: unknown[]; success: true; meta: { changes: number } }> {
    return await this.all()
  }

  async first(): Promise<unknown> {
    return this.#execute().results[0] ?? null
  }

  /** Synchronous run, for `batch` inside a transaction. */
  runSync(): { results: unknown[]; success: true; meta: { changes: number } } {
    const { results, changes } = this.#execute()
    return { results, success: true, meta: { changes } }
  }
}

export interface FakeD1 {
  binding: D1Database
  sqlite: Database.Database
}

export function fakeD1(): FakeD1 {
  const sqlite = new Database(':memory:')
  const binding = {
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    batch: async (statements: FakeStatement[]) =>
      sqlite.transaction(() => statements.map((statement) => statement.runSync()))(),
    exec: async (sql: string) => {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
  return { binding: binding as unknown as D1Database, sqlite }
}
