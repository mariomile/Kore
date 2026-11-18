import type { Fetch } from './cloudflare'

/** An agent approved on Kore Cloud's consent page. */
export interface KoreCloudAgent {
  id: string
  name: string
  access: 'read' | 'write'
  /** ISO time it was approved. */
  createdAt: string
}

interface RemoteNote {
  version: number
  source: string | null
}

/** A client for one Kore Cloud Worker, authenticated with the owner key. */
export class KoreCloud {
  readonly #url: string
  readonly #key: string
  readonly #fetch: Fetch

  constructor(url: string, ownerKey: string, fetcher: Fetch = fetch) {
    this.#url = url.replace(/\/+$/, '')
    this.#key = ownerKey
    this.#fetch = fetcher
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(`${this.#url}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.#key}`, 'content-type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(
        `Kore Cloud ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
      )
    }
    return (await response.json()) as T
  }

  /** The Worker's `/info`, or null while it does not answer yet. */
  async info(): Promise<{ name: string; version: string } | null> {
    try {
      const response = await this.#fetch(`${this.#url}/info`)
      return response.ok ? ((await response.json()) as { name: string; version: string }) : null
    } catch {
      return null
    }
  }

  /** Every note in Kore Cloud with its version, from the change feed. */
  async notes(): Promise<Map<string, RemoteNote>> {
    const notes = new Map<string, RemoteNote>()
    let since = 0
    for (;;) {
      const page = await this.#request<{
        changes: { path: string; source: string | null; version: number }[]
        cursor: number
        more: boolean
      }>(`/sync/changes?since=${since}&limit=500`)
      for (const change of page.changes) {
        notes.set(change.path, { version: change.version, source: change.source })
      }
      if (!page.more) {
        return notes
      }
      since = page.cursor
    }
  }

  async push(
    writes: {
      path: string
      source: string
      baseVersion: number
      meta: { title: string; tags: string[]; text: string }
    }[],
  ): Promise<{ path: string; status: string; reason?: string }[]> {
    const { results } = await this.#request<{
      results: { path: string; status: string; reason?: string }[]
    }>('/sync/push', { method: 'POST', body: JSON.stringify({ writes }) })
    return results
  }

  /** The agents approved on the consent page, newest first. */
  async agents(): Promise<KoreCloudAgent[]> {
    const { agents } = await this.#request<{ agents: KoreCloudAgent[] }>('/agents')
    return agents
  }

  /** Disconnect one agent: its tokens stop working at once. */
  async revokeAgent(id: string): Promise<void> {
    const response = await this.#fetch(`${this.#url}/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.#key}` },
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`Kore Cloud could not disconnect the agent (HTTP ${response.status})`)
    }
  }
}
