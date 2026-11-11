import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { vaultLayoutFromObsidian, type VaultLayout } from '@kore/core/graph/vault-layout'
import {
  MAX_SOURCE_BYTES,
  byteLength,
  describeNote,
  isNotePath,
  isPrivateSource,
} from '../src/note'
import type { Fetch } from './cloudflare'

/**
 * The first upload of a vault's notes into Kore Cloud, over the Worker's own
 * `/sync/*` API with the owner key. It never overwrites a note already in
 * Kore Cloud: a note that is there with other text (an agent added to it, or
 * it changed on the Mac since the last setup) is left as it is and reported,
 * for app sync to reconcile. Private notes, hidden folders and notes over
 * 1 MB stay on the Mac.
 */

/** Writes per push: the Worker's cap for pushes that carry `meta`. */
export const PUSH_BATCH = 20

/** A vault note read from disk. */
export interface LocalNote {
  path: string
  source: string
}

export interface UploadReport {
  /** Notes sent to Kore Cloud now. */
  uploaded: number
  /** Notes already there with the same text. */
  unchanged: number
  /** Notes already there with other text, left as they are. */
  differs: string[]
  /** `private: true` notes, which never leave the Mac. */
  private: number
  /** Notes over 1 MB. */
  tooLarge: string[]
  /** Notes the Worker refused or that lost a race, with the reason. */
  failed: { path: string; reason: string }[]
}

/** The vault layout its `.obsidian/` files declare (Kore's default without them). */
export async function readVaultLayout(vault: string): Promise<VaultLayout> {
  const read = async (name: string): Promise<string | null> => {
    try {
      return await readFile(join(vault, '.obsidian', name), 'utf8')
    } catch {
      return null
    }
  }
  const [dailyNotes, app, templates] = await Promise.all([
    read('daily-notes.json'),
    read('app.json'),
    read('templates.json'),
  ])
  return vaultLayoutFromObsidian({ dailyNotes, app, templates })
}

/** Every Markdown note of the vault outside hidden folders, as vault-relative paths. */
export async function readVaultNotes(vault: string): Promise<LocalNote[]> {
  const entries = await readdir(vault, { recursive: true, withFileTypes: true })
  const notes: LocalNote[] = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const absolute = join(entry.parentPath, entry.name)
    const path = relative(vault, absolute).split(sep).join('/')
    if (!isNotePath(path)) {
      continue
    }
    notes.push({ path, source: await readFile(absolute, 'utf8') })
  }
  return notes.sort((left, right) => left.path.localeCompare(right.path))
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
}

/**
 * Send the notes Kore Cloud does not have yet, in pushes of {@link PUSH_BATCH}
 * with the app's own parse as `meta`. Call `setVaultLayout` with the vault's
 * layout first, so daily notes parse as they do in the app.
 */
export async function uploadNotes(
  cloud: KoreCloud,
  local: LocalNote[],
  log: (line: string) => void = () => {},
): Promise<UploadReport> {
  const report: UploadReport = {
    uploaded: 0,
    unchanged: 0,
    differs: [],
    private: 0,
    tooLarge: [],
    failed: [],
  }
  const remote = await cloud.notes()
  const pending: LocalNote[] = []
  for (const note of local) {
    if (isPrivateSource(note.source)) {
      report.private += 1
      continue
    }
    if (byteLength(note.source) > MAX_SOURCE_BYTES) {
      report.tooLarge.push(note.path)
      continue
    }
    const there = remote.get(note.path)
    if (there === undefined) {
      pending.push(note)
    } else if (there.source === note.source) {
      report.unchanged += 1
    } else {
      report.differs.push(note.path)
    }
  }
  for (let start = 0; start < pending.length; start += PUSH_BATCH) {
    const batch = pending.slice(start, start + PUSH_BATCH)
    const results = await cloud.push(
      batch.map((note) => {
        const { title, tags, text } = describeNote(note.path, note.source)
        return { path: note.path, source: note.source, baseVersion: 0, meta: { title, tags, text } }
      }),
    )
    for (const result of results) {
      if (result.status === 'ok') {
        report.uploaded += 1
      } else {
        report.failed.push({
          path: result.path,
          reason: result.reason ?? 'changed in Kore Cloud during the upload',
        })
      }
    }
    log(`Notes uploaded: ${Math.min(start + PUSH_BATCH, pending.length)} of ${pending.length}`)
  }
  return report
}
