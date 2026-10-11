/**
 * Placeholder expansion for note templates (docs/porting/note-templates.md):
 * a template body may carry `{{date}}`, `{{date:iso}}`, `{{time}}`, and
 * `{{title}}` tokens, filled in at insertion time. Obsidian's core-template
 * forms `{{date:YYYY-MM-DD}}` and `{{time:HH:mm}}` (moment tokens) are filled
 * too, so an adopted vault's own templates work unchanged. Pure text over provided
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
  /**
   * The clock reading behind {@link time}, for `{{time:HH:mm}}`-style
   * tokens. Without it those tokens fall back to {@link time}.
   */
  now?: Date
}

// Whitespace inside the braces and any casing of the name are accepted;
// anything else is not a placeholder and passes through untouched (a
// template about templating stays writable). `date:iso` is Kore's spelling;
// any other `date:`/`time:` argument is a moment format (Obsidian's).
const PLACEHOLDER = /\{\{\s*(title|date|time)(?::([^{}]*?))?\s*\}\}/gi

const MOMENT_TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|[hAa]|mm|ss/g

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Format a local date-time with the moment tokens Obsidian templates use
 * (`YYYY`, `MM`, `DD`, `dddd`, `MMMM`, `HH:mm`, …). Names follow the system
 * locale, as Obsidian's do. Unknown letters pass through.
 */
export function formatMoment(when: Date, format: string): string {
  const name = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(undefined, options).format(when)
  const hours12 = when.getHours() % 12 === 0 ? 12 : when.getHours() % 12
  return format.replaceAll(MOMENT_TOKEN_RE, (token, literal: string | undefined) => {
    if (literal !== undefined) {
      return literal
    }
    switch (token) {
      case 'YYYY':
        return String(when.getFullYear()).padStart(4, '0')
      case 'YY':
        return pad(when.getFullYear() % 100)
      case 'MMMM':
        return name({ month: 'long' })
      case 'MMM':
        return name({ month: 'short' })
      case 'MM':
        return pad(when.getMonth() + 1)
      case 'M':
        return String(when.getMonth() + 1)
      case 'DD':
        return pad(when.getDate())
      case 'D':
        return String(when.getDate())
      case 'dddd':
        return name({ weekday: 'long' })
      case 'ddd':
        return name({ weekday: 'short' })
      case 'HH':
        return pad(when.getHours())
      case 'H':
        return String(when.getHours())
      case 'hh':
        return pad(hours12)
      case 'h':
        return String(hours12)
      case 'mm':
        return pad(when.getMinutes())
      case 'ss':
        return pad(when.getSeconds())
      case 'A':
        return when.getHours() < 12 ? 'AM' : 'PM'
      case 'a':
        return when.getHours() < 12 ? 'am' : 'pm'
      default:
        return token
    }
  })
}

/** Local midnight of an ISO `YYYY-MM-DD` date. */
function localDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) {
    return null
  }
  const date = new Date(0, 0, 1)
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date
}

/**
 * An ISO `YYYY-MM-DD` day in a moment `format` (an Obsidian vault's
 * Templates date format), or `null` when `iso` is not a date.
 */
export function formatIsoDate(iso: string, format: string): string | null {
  const date = localDate(iso)
  return date === null ? null : formatMoment(date, format)
}

/** Expand the known placeholders in a template body against `values`. */
export function expandTemplatePlaceholders(
  body: string,
  values: TemplatePlaceholderValues,
): string {
  return body.replaceAll(PLACEHOLDER, (match, token: string, argument: string | undefined) => {
    const format = argument?.trim()
    switch (token.toLowerCase()) {
      case 'title':
        return format === undefined ? values.title : match
      case 'date': {
        if (format === undefined || format === '') {
          return values.date
        }
        if (format.toLowerCase() === 'iso') {
          return values.dateIso
        }
        const date = localDate(values.dateIso)
        return date === null ? match : formatMoment(date, format)
      }
      case 'time':
        if (format === undefined || format === '' || values.now === undefined) {
          return values.time
        }
        return formatMoment(values.now, format)
      default:
        return match
    }
  })
}
