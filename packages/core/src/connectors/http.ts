import type { z } from 'zod'
import { ReflectError } from '../errors'
import type { FetchFn } from '../sync/github-api'

/** Longest `Retry-After` a sync waits out in place before giving up the run. */
const MAX_RETRY_WAIT_MS = 60_000

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (header === null) {
    return null
  }
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GET a JSON endpoint of a connector's source and validate the body. A
 * rate-limit answer is waited out once when the source names a short
 * `Retry-After`; 401/403 map to `auth` (the token is wrong or revoked), other
 * failures to `network`, and a body the schema rejects to `parse`.
 */
export async function getJson<Schema extends z.ZodType>(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  schema: Schema,
  what: string,
): Promise<z.infer<Schema>> {
  let response = await fetchFn(url, { headers: { Accept: 'application/json', ...headers } })
  if (response.status === 429) {
    const wait = retryAfterMs(response) ?? 5_000
    if (wait > MAX_RETRY_WAIT_MS) {
      throw new ReflectError('network', `${what}: rate limited, try again later`)
    }
    await sleep(wait)
    response = await fetchFn(url, { headers: { Accept: 'application/json', ...headers } })
  }
  if (response.status === 401 || response.status === 403) {
    throw new ReflectError('auth', `${what}: the access token was rejected`)
  }
  if (!response.ok) {
    throw new ReflectError('network', `${what}: request failed (${response.status})`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ReflectError('network', `${what}: unreadable response (${response.status})`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ReflectError('parse', `${what}: unexpected response shape`)
  }
  return parsed.data
}
