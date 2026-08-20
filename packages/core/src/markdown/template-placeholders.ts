/**
 * Placeholder expansion for note templates (docs/porting/note-templates.md):
 * a template body may carry `{{date}}`, `{{date:iso}}`, `{{time}}`, and
 * `{{title}}` tokens, filled in at insertion time. Pure text over provided
 * values — the caller owns the clock, the user's date/time format
 * preferences, and the target note's title, so this stays deterministic and
 * platform-free.
 */

/** The values a template insertion resolves its placeholders against. */
export interface TemplatePlaceholderValues {
  /** The target note's display title (`{{title}}`). */
  title: string
  /** Today, in the user's date format (`{{date}}`). */
  date: string
  /** Today as `YYYY-MM-DD` (`{{date:iso}}`) — what daily wiki links want. */
  dateIso: string
  /** The current time of day, in the user's time format (`{{time}}`). */
  time: string
}

// `date:iso` must precede `date` in the alternation or the shorter token
// wins and strands `:iso}}` in the note. Whitespace inside the braces and
// any casing are accepted; anything else is not a placeholder and passes
// through untouched (a template about templating stays writable).
const PLACEHOLDER = /\{\{\s*(title|date:iso|date|time)\s*\}\}/gi

/** Expand the known placeholders in a template body against `values`. */
export function expandTemplatePlaceholders(
  body: string,
  values: TemplatePlaceholderValues,
): string {
  return body.replaceAll(PLACEHOLDER, (match, token: string) => {
    switch (token.toLowerCase()) {
      case 'title':
        return values.title
      case 'date':
        return values.date
      case 'date:iso':
        return values.dateIso
      case 'time':
        return values.time
      default:
        return match
    }
  })
}
