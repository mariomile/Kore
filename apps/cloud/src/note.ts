import { dateFromDailyPath } from '@kore/core/graph/paths'
import { parseNote } from '@kore/core/markdown/extract'
import { parseFrontmatter, splitFrontmatter } from '@kore/core/markdown/frontmatter'

/** What the store keeps beside a note's source so search and lookups work. */
export interface NoteMeta {
  title: string
  tags: string[]
  /** Plain text of the body, the full-text index's main column. */
  text: string
  /** ISO date for a daily note in the vault's layout, else null. */
  daily: string | null
}

/** Largest note source Kore Cloud stores (D1 caps a row at 2 MB). */
export const MAX_SOURCE_BYTES = 1_000_000

/**
 * True when the source carries `private: true` (the app's own coercion).
 * Private notes never enter Kore Cloud: every write path checks this.
 */
export function isPrivateSource(source: string): boolean {
  return parseFrontmatter(splitFrontmatter(source).raw).data.private
}

/** Title, tags, text and daily date, by the same parser the app indexes with. */
export function describeNote(path: string, source: string): NoteMeta {
  const note = parseNote({ path, source })
  return { title: note.title, tags: note.tags, text: note.text, daily: dateFromDailyPath(path) }
}

/**
 * A graph-relative Markdown path a client may write: relative, `.md`, no
 * `..`, and outside hidden folders such as `.git/` or `.kore/`.
 */
export function isNotePath(path: string): boolean {
  return (
    path.endsWith('.md') &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part !== '' && part !== '..' && !part.startsWith('.'))
  )
}

/** UTF-8 size of a string, for the per-note cap. */
export function byteLength(source: string): number {
  return new TextEncoder().encode(source).length
}
