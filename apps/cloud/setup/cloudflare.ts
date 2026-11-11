/**
 * The few Cloudflare API calls Kore Cloud setup makes, over plain `fetch`
 * with the user's own API token. Every response is Cloudflare's envelope
 * (`{ success, errors, result }`); a failure throws with Cloudflare's message.
 */

export const API = 'https://api.cloudflare.com/client/v4'

/** Permission groups the token needs, as Cloudflare's token page names them. */
export const TOKEN_PERMISSIONS = [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'd1', type: 'edit' },
  { key: 'workers_kv_storage', type: 'edit' },
  { key: 'account_settings', type: 'read' },
] as const

/**
 * The dashboard page that creates an account token with exactly those
 * permissions prefilled: the user picks the account, presses Create and
 * copies the token. Nothing is created until they do.
 */
export function tokenPageUrl(name = 'Kore Cloud'): string {
  const permissions = encodeURIComponent(JSON.stringify(TOKEN_PERMISSIONS))
  return `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${permissions}&name=${encodeURIComponent(name)}`
}

export class CloudflareError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface Envelope<T> {
  success?: boolean
  errors?: { code?: number; message?: string }[]
  result?: T
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** A Cloudflare API client bound to one token. */
export class Cloudflare {
  readonly #token: string
  readonly #fetch: Fetch

  constructor(token: string, fetcher: Fetch = fetch) {
    this.#token = token
    this.#fetch = fetcher
  }

  /** One API call; `body` is JSON unless it is FormData. */
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#token}` }
    let payload: FormData | string | undefined
    if (body instanceof FormData) {
      payload = body
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await this.#fetch(`${API}${path}`, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: payload }),
      })
    } catch (cause) {
      const reason = (cause as { cause?: { message?: string } }).cause?.message ?? String(cause)
      throw new CloudflareError(`Could not reach Cloudflare (${reason}).`, 0)
    }
    let envelope: Envelope<T> = {}
    try {
      envelope = (await response.json()) as Envelope<T>
    } catch {
      // Not JSON: fall through to the status check below.
    }
    if (!response.ok || envelope.success === false) {
      const message =
        envelope.errors
          ?.map((error) => error.message)
          .filter(Boolean)
          .join('; ') || `HTTP ${response.status}`
      throw new CloudflareError(`${method} ${path}: ${message}`, response.status)
    }
    return envelope.result as T
  }
}
