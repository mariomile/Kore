/**
 * Auto-stamped timestamp columns (Plan 29 T1). `created` is stamped into
 * frontmatter once, when a note joins the tag through Kore (it is a
 * starting value that is always `today`, `startingValueOf`) — portable truth that
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
