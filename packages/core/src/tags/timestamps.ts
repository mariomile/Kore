import { parseFrontmatter, splitFrontmatter } from '../markdown'
import type { TagType } from './tag-type'

/**
 * Auto-stamped timestamp columns (Plan 29 T1). `created` is stamped into
 * frontmatter once, when Kore itself births the row — portable truth that
 * survives a git clone or an iCloud copy, unlike filesystem birthtime, which
 * both silently rewrite. A note tagged into the collection by hand keeps an
 * empty cell: its history predates the membership, and inventing a date
 * would be a lie. `updated` stores nothing at all — the view reads the
 * index's mtime (`attachTimestampColumns`).
 */

/** The local calendar day (`YYYY-MM-DD`) a stamp records. */
export function localCalendarDate(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * The frontmatter values a row born now carries for its `created`
 * properties. Callers spread these *under* their own values, so an explicit
 * value (a CSV import's historical date, a caller that already knows) wins
 * over the stamp.
 */
export function createdStampValues(
  type: TagType | null | undefined,
  at: Date = new Date(),
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const property of type?.properties ?? []) {
    if (property.type === 'created') {
      values[property.key] = localCalendarDate(at)
    }
  }
  return values
}

/**
 * The `created` stamps a note does not already carry, for a membership the
 * app itself writes (the Type picker, `reflect tag`). Editing `#tag` into the
 * markdown by hand still stamps nothing — there is no gesture to hang it on —
 * but an explicit "this note is a #book" carries the same meaning as birthing
 * the row, so its `Added`-style column gets today's date. A key already in the
 * frontmatter is left alone: the note's own value is the truth, and a second
 * tagging must not move it.
 */
export function missingCreatedStamps(
  source: string,
  type: TagType | null | undefined,
  at: Date = new Date(),
): Record<string, string> {
  const stamps = createdStampValues(type, at)
  if (Object.keys(stamps).length === 0) {
    return {}
  }
  const { data } = parseFrontmatter(splitFrontmatter(source).raw)
  const present = data as Record<string, unknown>
  const missing: Record<string, string> = {}
  for (const [key, value] of Object.entries(stamps)) {
    if (present[key] === undefined) {
      missing[key] = value
    }
  }
  return missing
}
