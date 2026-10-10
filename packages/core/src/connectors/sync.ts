import { isAppError, ReflectError } from '../errors'
import { createNoteIfAbsent, readNote, writeNote } from '../graph/commands'
import { classifyGraphPath } from '../graph/paths'
import { db } from '../indexing/db'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import type { FetchFn } from '../sync/github-api'
import type { Connector, ConnectorNote } from './types'

/**
 * The connector sync engine: pulls a connector's notes and places them in the
 * graph as plain markdown. It owns everything a connector shouldn't — folder
 * placement, filename collisions, finding a note again across runs and
 * devices, and the rule that a file Kore did not write is never touched.
 *
 * A note is found again by its frontmatter id (`readwise_id`, `granola_id`):
 * first through the index's `note_properties` projection, then by reading
 * the file at the note's natural path, so a note synced on another device
 * whose index row has not landed yet is still recognized.
 */

/** Far beyond any real same-title population; fail loud instead of spinning. */
const MAX_PATH_ATTEMPTS = 100

export interface SyncConnectorInput {
  readonly connector: Connector
  /** The connector's credential, read from the OS keychain by the caller. */
  readonly token: string
  /** Graph-relative destination folder; `''` is the graph root. */
  readonly folder: string
  /** The last successful sync, or `null` for a first (full) sync. */
  readonly since: Date | null
  /**
   * Never import items older than this, whatever `since` says — set when the
   * user connects without importing history (the older items usually already
   * live in the vault, written by another app).
   */
  readonly floor: Date | null
  /** `GraphInfo.generation` — pins every read and write to the issuing graph. */
  readonly generation: number
  readonly fetchFn: FetchFn
  /** Abort gate (graph switch / unmount), checked between notes. */
  readonly isStale: () => boolean
}

export interface ConnectorSyncResult {
  /** Notes written for the first time. */
  readonly created: number
  /** Existing notes that received new content. */
  readonly updated: number
  /**
   * When this run started — the next run's `since`. `null` when the run was
   * cut short, so the next run repeats the window instead of skipping it.
   */
  readonly syncedAt: string | null
}

/**
 * Normalize a user-entered destination folder to a graph-relative path, or
 * throw a `parse` error for one that would leave the graph, hide the notes,
 * or land in a reserved tree.
 */
export function normalizeConnectorFolder(folder: string): string {
  const trimmed = folder
    .trim()
    .replaceAll(/^\/+|\/+$/g, '')
    .replaceAll(/\/{2,}/g, '/')
  if (trimmed === '') {
    return ''
  }
  if (classifyGraphPath(`${trimmed}/note.md`) !== 'note') {
    throw new ReflectError('parse', `"${folder}" can’t hold notes; choose another folder`)
  }
  return trimmed
}

function frontmatterId(source: string, idKey: string): string | null {
  const value: unknown = parseFrontmatter(splitFrontmatter(source).raw).data[idKey]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

async function indexedPath(idKey: string, sourceId: string): Promise<string | null> {
  const row = await db
    .selectFrom('noteProperties')
    .select('notePath')
    .where('key', '=', idKey)
    .where('value', '=', sourceId)
    .limit(1)
    .executeTakeFirst()
  return row?.notePath ?? null
}

async function readIfPresent(path: string, generation: number): Promise<string | null> {
  try {
    return await readNote(path, generation)
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') {
      return null
    }
    throw cause
  }
}

type Placement = 'created' | 'updated' | 'unchanged'

async function mergeInto(
  path: string,
  existing: string,
  note: ConnectorNote,
  generation: number,
): Promise<Placement> {
  const merged = note.merge(existing)
  if (merged === null || merged === existing) {
    return 'unchanged'
  }
  await writeNote(path, merged, generation)
  return 'updated'
}

function candidatePath(folder: string, stem: string, ordinal: number): string {
  const name = ordinal === 1 ? `${stem}.md` : `${stem} ${ordinal}.md`
  return folder === '' ? name : `${folder}/${name}`
}

/** The window start: the last sync minus the overlap, but never before `floor`. */
function effectiveSince(since: Date | null, floor: Date | null, overlapMs: number): Date | null {
  const overlapped = since === null ? null : new Date(since.getTime() - overlapMs)
  if (floor === null) {
    return overlapped
  }
  return overlapped === null || overlapped < floor ? floor : overlapped
}

/**
 * Sync one connector into the graph. Throws on a source or credential
 * failure (`auth`, `network`, `parse`); notes already placed stay placed.
 */
export async function syncConnector(input: SyncConnectorInput): Promise<ConnectorSyncResult> {
  const { connector, generation } = input
  const folder = normalizeConnectorFolder(input.folder)
  const startedAt = new Date().toISOString()
  /** Paths placed by this run — the index lags our own writes. */
  const placed = new Map<string, string>()

  async function knownPath(sourceId: string): Promise<string | null> {
    return placed.get(sourceId) ?? (await indexedPath(connector.idKey, sourceId))
  }

  async function place(note: ConnectorNote): Promise<Placement> {
    const known = await knownPath(note.sourceId)
    if (known !== null) {
      const existing = await readIfPresent(known, generation)
      if (existing !== null && frontmatterId(existing, connector.idKey) === note.sourceId) {
        placed.set(note.sourceId, known)
        return await mergeInto(known, existing, note, generation)
      }
    }
    for (let ordinal = 1; ordinal <= MAX_PATH_ATTEMPTS; ordinal += 1) {
      const path = candidatePath(folder, note.fileStem, ordinal)
      const outcome = await createNoteIfAbsent(path, note.source, generation)
      if (outcome.kind === 'created') {
        placed.set(note.sourceId, path)
        return 'created'
      }
      // Occupied: ours from another device (merge into it), or a file Kore
      // didn't write for this item (never touched; try the next name).
      const existing = await readIfPresent(path, generation)
      if (existing !== null && frontmatterId(existing, connector.idKey) === note.sourceId) {
        placed.set(note.sourceId, path)
        return await mergeInto(path, existing, note, generation)
      }
    }
    throw new ReflectError(
      'io',
      `no free filename for "${note.fileStem}" in ${folder || 'the graph'}`,
    )
  }

  let created = 0
  let updated = 0
  const since = effectiveSince(input.since, input.floor, connector.overlapMs)
  const notes = connector.fetchNotes({
    token: input.token,
    since,
    fetchFn: input.fetchFn,
    isStale: input.isStale,
    hasNote: async (sourceId) => (await knownPath(sourceId)) !== null,
  })
  for await (const note of notes) {
    if (input.isStale()) {
      return { created, updated, syncedAt: null }
    }
    const outcome = await place(note)
    if (outcome === 'created') {
      created += 1
    } else if (outcome === 'updated') {
      updated += 1
    }
  }
  return { created, updated, syncedAt: input.isStale() ? null : startedAt }
}
