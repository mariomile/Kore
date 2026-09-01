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
