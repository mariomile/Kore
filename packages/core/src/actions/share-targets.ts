import { shareTargetsWrite } from '../graph/commands'
import { getVaultLayout } from '../graph/vault-layout'
import { db } from '../indexing/db'

/**
 * The note list the iOS share sheet offers ("a note…", "new note in a
 * folder"). The share extension never opens the vault or its index, so the
 * app publishes this snapshot into the App Group container whenever it goes
 * to the background; the extension searches it offline. Format version 1,
 * mirrored by `ShareTargets.swift`.
 */

/** Most recently edited notes kept; enough to search a large vault by title. */
const MAX_NOTES = 8_000
/** Folders offered for a new note, most populated first. */
const MAX_FOLDERS = 200
/** Folder depth offered (`Projects/Kore` but not deeper). */
const MAX_FOLDER_DEPTH = 2

/** One note the share sheet can append to. */
export interface ShareTargetNote {
  readonly path: string
  readonly title: string
  /** File modification time (epoch ms) — the list's recency order. */
  readonly mtime: number
}

/** A folder a new note can be created in, with how many notes it holds. */
export interface ShareTargetFolder {
  /** Graph-relative, no trailing slash; `''` is the vault root. */
  readonly path: string
  readonly count: number
}

/** The snapshot written as `share-targets.json`. */
export interface ShareTargets {
  readonly version: 1
  readonly notes: readonly ShareTargetNote[]
  readonly folders: readonly ShareTargetFolder[]
  /** The vault's own new-note folder, the sheet's default for a new note. */
  readonly newNoteFolder: string
}

/** The folders a set of note paths sits in, up to {@link MAX_FOLDER_DEPTH}. */
export function shareTargetFolders(paths: readonly string[]): ShareTargetFolder[] {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const parts = path.split('/').slice(0, -1)
    for (let depth = 1; depth <= Math.min(parts.length, MAX_FOLDER_DEPTH); depth += 1) {
      const folder = parts.slice(0, depth).join('/')
      counts.set(folder, (counts.get(folder) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .sort((first, second) => second.count - first.count || first.path.localeCompare(second.path))
    .slice(0, MAX_FOLDERS)
}

/** Build the snapshot from the index: regular notes (no dailies or templates), newest first. */
export async function buildShareTargets(): Promise<ShareTargets> {
  const rows = await db
    .selectFrom('notes')
    .where('notes.kind', '=', 'note')
    .select(['notes.path', 'notes.title', 'notes.mtime'])
    .orderBy('notes.mtime', 'desc')
    .orderBy('notes.path')
    .limit(MAX_NOTES)
    .execute()
  return {
    version: 1,
    notes: rows.map((row) => ({ path: row.path, title: row.title, mtime: row.mtime })),
    folders: shareTargetFolders(rows.map((row) => row.path)),
    newNoteFolder: getVaultLayout().newNoteFolder,
  }
}

/** Publish the snapshot for the share extension (a no-op off iOS). */
export async function publishShareTargets(): Promise<void> {
  await shareTargetsWrite(JSON.stringify(await buildShareTargets()))
}
