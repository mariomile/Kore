import { MAX_SOURCE_BYTES, byteLength, isNotePath, isPrivateSource } from './note'
import type { NoteStore, NoteText, WriteOutcome, WriteRequest } from './store'

/**
 * The Kore app's two-way sync over plain HTTP, authenticated with the vault's
 * access key (never an agent's OAuth token):
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

function parseMeta(value: unknown): NoteText | undefined | 'invalid' {
  if (value === undefined || value === null) {
    return undefined
  }
  const { title, tags, text } = value as Record<string, unknown>
  if (
    typeof title !== 'string' ||
    typeof text !== 'string' ||
    !Array.isArray(tags) ||
    tags.some((tag) => typeof tag !== 'string')
  ) {
    return 'invalid'
  }
  return { title, tags: tags as string[], text }
}

function parseWrites(body: unknown): WriteRequest[] | string {
  const writes = (body as { writes?: unknown } | null)?.writes
  if (!Array.isArray(writes)) {
    return 'body must be { writes: [...] }'
  }
  if (writes.length > MAX_PUSH_WRITES) {
    return `at most ${MAX_PUSH_WRITES} writes per push`
  }
  const parsed: WriteRequest[] = []
  const seen = new Set<string>()
  let unparsed = 0
  for (const write of writes as unknown[]) {
    const { path, source, baseVersion, meta } = (write ?? {}) as Record<string, unknown>
    if (
      typeof path !== 'string' ||
      (source !== null && typeof source !== 'string') ||
      typeof baseVersion !== 'number' ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0
    ) {
      return 'each write needs a string path, a string or null source, and an integer baseVersion'
    }
    if (seen.has(path)) {
      return `${path} appears twice in one push`
    }
    seen.add(path)
    const text = parseMeta(meta)
    if (text === 'invalid') {
      return 'meta must be { title: string, tags: string[], text: string }'
    }
    if (source !== null && text === undefined) {
      unparsed += 1
    }
    parsed.push({ path, source, baseVersion, meta: text })
  }
  if (unparsed > MAX_UNPARSED_PUSH_WRITES) {
    return `at most ${MAX_UNPARSED_PUSH_WRITES} writes without meta per push`
  }
  return parsed
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

/** Handle `/sync/*` (already authenticated with the access key). */
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
