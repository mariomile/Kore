import { sql } from 'kysely'
import { attachmentCatalogHas } from '../graph/attachment-index'
import { db } from './db'

/**
 * Does an indexed reference name this file? A bare `![[photo.png]]` is stored
 * as authored because the index cannot know its folder, so it matches any
 * attachment with that filename. Over-matching is the safe direction: it can
 * only make the privacy gate more conservative.
 */
export function assetReferenceMatches(reference: string, assetPath: string): boolean {
  return reference.includes('/')
    ? reference === assetPath
    : reference === (assetPath.split('/').at(-1) ?? assetPath)
}

/**
 * The notes that reference an asset, from the index `assets` projection (Plan
 * 20). Used only to find *candidates* cheaply — the asset-description privacy gate
 * re-reads each candidate's live markdown before trusting it, so an index that
 * lags the watcher can never cause a private note to be missed for long (any
 * reference is written by a note change that itself triggers re-indexing).
 *
 * `assetPath` is the canonical graph-relative path, e.g. `assets/diagram.png`.
 * The query matches both that exact spelling and the bare basename a wiki
 * embed stores; {@link assetReferenceMatches} re-applies the same rule to the
 * candidate's live markdown.
 */
export async function assetReferencingNotePaths(assetPath: string): Promise<string[]> {
  const basename = assetPath.split('/').at(-1) ?? assetPath
  const rows = await db
    .selectFrom('assets')
    .where((eb) => eb.or([eb('assetPath', '=', assetPath), eb('assetPath', '=', basename)]))
    .select('notePath')
    .distinct()
    .execute()
  return rows.map((row) => row.notePath)
}

/** Raster formats a card thumbnail can show (SVG is excluded on purpose). */
const THUMBNAIL_EXTENSIONS = new Set(['avif', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'webp'])

function isThumbnailAsset(assetPath: string): boolean {
  const dot = assetPath.lastIndexOf('.')
  return dot !== -1 && THUMBNAIL_EXTENSIONS.has(assetPath.slice(dot + 1).toLowerCase())
}

/**
 * Each note's first referenced raster image, from the index `assets`
 * projection, keyed by note path; notes without one are absent. One indexed
 * query for a whole batch of cards, so a note grid can show a photo without
 * reading or rendering any note body. References come back in the order the
 * indexer stored them (document order). The projection stores every spelling
 * of a reference (`assets/x.png` written in `notes/a.md` is both
 * `notes/assets/x.png` and `assets/x.png`), so a path the attachment catalog
 * doesn't know is skipped; a bare `![[photo.png]]` stays as authored, for the
 * host's asset resolver to place.
 */
export async function firstImageAssets(notePaths: readonly string[]): Promise<Map<string, string>> {
  const firstByNote = new Map<string, string>()
  if (notePaths.length === 0) {
    return firstByNote
  }
  const rows = await db
    .selectFrom('assets')
    .where('notePath', 'in', [...notePaths])
    .select(['notePath', 'assetPath'])
    .orderBy(sql`rowid`)
    .execute()
  for (const row of rows) {
    if (
      !firstByNote.has(row.notePath) &&
      isThumbnailAsset(row.assetPath) &&
      (!row.assetPath.includes('/') || attachmentCatalogHas(row.assetPath))
    ) {
      firstByNote.set(row.notePath, row.assetPath)
    }
  }
  return firstByNote
}
