import { z } from 'zod'
import { MAX_SOURCE_BYTES, byteLength, isNotePath, isPrivateSource } from './note'
import type { NoteStore, WriteOutcome, WriteRequest } from './store'

/**
 * The Kore app's two-way sync over plain HTTP, authenticated with the vault's
 * owner key (never an agent's OAuth token):
 *
 * - `GET /sync/changes?since=<seq>&limit=<n>`: every write after `since`,
 *   oldest first, deletions as `source: null`. The client stores the last
 *   `seq` it applied and asks again while `more` is true.
 * - `POST /sync/push` with `{ writes: [{ path, source | null, baseVersion, meta? }] }`:
 *   compare-and-swap writes. `meta` is the note's title, tags and text as the
 *   app's own parser read them, which spares the Worker's CPU budget. Each comes back `ok` with its new version, or
 *   `conflict` with the note as it is now so the client keeps both sides,
 *   or `rejected` with the reason (bad path, private, too large).
 */

/**
 * Most writes one push may carry. Bounded by D1's per-invocation query cap:
 * a push is one batch of `1 + writes` statements plus one conflict read.
 */
export const MAX_PUSH_WRITES = 20

/**
 * Most writes in one push that arrive without `meta`, which the Worker must
 * parse itself. Parsing a typical note costs about 1 ms of CPU (median of a
 * 5,165-note vault, p95 2.7 ms) and Workers Free allows 10 ms per request.
 */
export const MAX_UNPARSED_PUSH_WRITES = 5

const DEFAULT_CHANGES = 200
const MAX_CHANGES = 500

export type PushResult =
  | ({ path: string } & WriteOutcome)
  | { path: string; status: 'rejected'; reason: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function badRequest(message: string): Response {
  return json({ error: message }, 400)
}

function nonNegativeInteger(value: string | null, fallback: number): number | null {
  if (value === null || value === '') {
    return fallback
  }
  return /^\d+$/.test(value) ? Number(value) : null
}

async function changes(url: URL, store: NoteStore): Promise<Response> {
  const since = nonNegativeInteger(url.searchParams.get('since'), 0)
  const limit = nonNegativeInteger(url.searchParams.get('limit'), DEFAULT_CHANGES)
  if (since === null || limit === null || limit === 0) {
    return badRequest('`since` and `limit` must be non-negative integers (limit at least 1)')
  }
  const capped = Math.min(limit, MAX_CHANGES)
  const page = await store.changes(since, capped)
  const last = page.at(-1)
  return json({ changes: page, cursor: last?.seq ?? since, more: page.length === capped })
}

/** Why a write may not enter the store, or null when it may. */
export function rejectWrite(write: WriteRequest): string | null {
  if (!isNotePath(write.path)) {
    return 'not a vault-relative .md path outside hidden folders'
  }
  if (write.source !== null) {
    if (isPrivateSource(write.source)) {
      return 'private notes never enter Kore Cloud'
    }
    if (byteLength(write.source) > MAX_SOURCE_BYTES) {
      return 'larger than Kore Cloud stores (1 MB)'
    }
  }
  return null
}

/** Longest title or index text a push may carry for one note. */
const MAX_META_CHARS = MAX_SOURCE_BYTES

const metaSchema = z.object({
  title: z.string().max(MAX_META_CHARS),
  tags: z.array(z.string().max(200)).max(500),
  text: z.string().max(MAX_META_CHARS),
})

const writeSchema = z.object({
  path: z.string().max(1024),
  source: z.string().nullable(),
  baseVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  meta: metaSchema.nullish(),
})

const pushSchema = z.object({ writes: z.array(writeSchema).max(MAX_PUSH_WRITES) })

function parseWrites(body: unknown): WriteRequest[] | string {
  const parsed = pushSchema.safeParse(body)
  if (!parsed.success) {
    return z.prettifyError(parsed.error)
  }
  const seen = new Set<string>()
  let unparsed = 0
  const writes: WriteRequest[] = []
  for (const { path, source, baseVersion, meta } of parsed.data.writes) {
    if (seen.has(path)) {
      return `${path} appears twice in one push`
    }
    seen.add(path)
    if (source !== null && (meta === undefined || meta === null)) {
      unparsed += 1
    }
    writes.push({ path, source, baseVersion, meta: meta ?? undefined })
  }
  if (unparsed > MAX_UNPARSED_PUSH_WRITES) {
    return `at most ${MAX_UNPARSED_PUSH_WRITES} writes without meta per push`
  }
  return writes
}

async function push(request: Request, store: NoteStore): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('body is not JSON')
  }
  const writes = parseWrites(body)
  if (typeof writes === 'string') {
    return badRequest(writes)
  }
  const results: (PushResult | null)[] = writes.map((write) => {
    const reason = rejectWrite(write)
    return reason === null ? null : { path: write.path, status: 'rejected', reason }
  })
  const accepted = writes.filter((_, index) => results[index] === null)
  const outcomes = await store.writeMany(accepted)
  let next = 0
  return json({
    results: results.map((result, index) => {
      if (result !== null) {
        return result
      }
      const outcome = outcomes[next] as WriteOutcome
      next += 1
      return { path: (writes[index] as WriteRequest).path, ...outcome }
    }),
  })
}

/** Handle `/sync/*` (already authenticated with the owner key). */
export async function handleSync(request: Request, store: NoteStore): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/sync/changes' && request.method === 'GET') {
    return await changes(url, store)
  }
  if (url.pathname === '/sync/push' && request.method === 'POST') {
    return await push(request, store)
  }
  return json({ error: 'not found' }, 404)
}
