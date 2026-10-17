/**
 * Obsidian callouts (`> [!note] Title`), a superset of GitHub alerts
 * (`> [!NOTE]`). The file keeps a plain blockquote that any editor can
 * round-trip; meowdown has no callout node, so hosts read the marker off the
 * blockquote's first line and style it.
 */

/**
 * The callout kinds Obsidian styles, in Obsidian's own order. Every other
 * type token resolves to one of these through {@link CALLOUT_ALIASES}, and an
 * unknown token falls back to `note`, as Obsidian does.
 */
export const CALLOUT_KINDS = [
  'note',
  'abstract',
  'info',
  'todo',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

/** Obsidian's alias tokens, each styled as the kind it names. */
export const CALLOUT_ALIASES: Readonly<Record<string, CalloutKind>> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

/**
 * Whether a callout folds, from the character right after `]`: none is a
 * plain callout, `+` folds but starts open, `-` starts collapsed.
 */
export type CalloutFold = 'none' | 'open' | 'closed'

/** A parsed `> [!type]± Title` marker line. */
export interface CalloutMarker {
  /** The styling kind; unknown types resolve to `note`. */
  readonly kind: CalloutKind
  /** The type token as written, lowercased (`faq`, `my-type`). */
  readonly type: string
  /** The title after the marker; null when the line is the marker alone. */
  readonly title: string | null
  readonly fold: CalloutFold
  /**
   * Characters from the start of the line to where the title begins (or the
   * line's end), so a host can hide the marker and keep the title.
   */
  readonly markerLength: number
}

const MARKER_RE = /^([ \t]*\[!([\p{L}\p{N}_-]+)\]([+-]?))(?:([ \t]+)(.*))?$/u

function kindFromType(type: string): CalloutKind {
  if ((CALLOUT_KINDS as readonly string[]).includes(type)) {
    return type as CalloutKind
  }
  return CALLOUT_ALIASES[type] ?? 'note'
}

/**
 * Parse a blockquote's first line as a callout marker. Returns null when the
 * line is ordinary quoted prose.
 */
export function parseCalloutMarker(line: string): CalloutMarker | null {
  const match = MARKER_RE.exec(line.trimEnd())
  if (match === null) {
    return null
  }
  const [, marker = '', rawType = '', foldChar = '', gap = '', rest = ''] = match
  const type = rawType.toLowerCase()
  const title = rest.trim()
  return {
    kind: kindFromType(type),
    type,
    title: title === '' ? null : title,
    fold: foldChar === '-' ? 'closed' : foldChar === '+' ? 'open' : 'none',
    markerLength: title === '' ? marker.length : marker.length + gap.length,
  }
}

/**
 * The heading a callout shows: its own title, else the type as written with
 * its first letter raised (`[!faq]` reads "Faq"), as Obsidian does.
 */
export function calloutLabel(marker: CalloutMarker): string {
  return marker.title ?? marker.type.charAt(0).toUpperCase() + marker.type.slice(1)
}

/** The markdown inserted by the `/` menu for an empty callout of `kind`. */
export function formatCalloutBlock(kind: CalloutKind): string {
  return `> [!${kind.toUpperCase()}]\n> \n`
}

const QUOTE_PREFIX_RE = /^((?:[ \t]{0,3}>[ \t]?)+)(.*)$/
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

function quoteDepth(prefix: string): number {
  return prefix.split('>').length - 1
}

/**
 * Give every callout's title line a paragraph of its own, so a read-only
 * renderer draws the title apart from the body that follows it on the next
 * line (`> [!note] Title\n> body` is one paragraph in CommonMark). Only the
 * rendered copy changes; the file never sees this. Lines inside fenced code
 * are left alone.
 */
export function separateCalloutTitles(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence: string | null = null
  // Depth and blankness of the previous line, to tell a blockquote's first
  // line (where a marker counts) from a continuation line.
  let previousDepth = 0
  let previousBlank = true
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    out.push(line)
    const quoted = QUOTE_PREFIX_RE.exec(line)
    const prefix = quoted?.[1] ?? ''
    const content = quoted?.[2] ?? line
    const depth = quoted === null ? 0 : quoteDepth(prefix)
    const fenceMatch = FENCE_RE.exec(content)
    if (fence !== null) {
      const closing = fenceMatch?.[1] ?? ''
      if (closing.charAt(0) === fence.charAt(0) && closing.length >= fence.length) {
        fence = null
      }
    } else if (fenceMatch !== null) {
      fence = fenceMatch[1] ?? null
    } else if (
      depth > 0 &&
      (depth > previousDepth || previousBlank) &&
      parseCalloutMarker(content) !== null
    ) {
      const next = QUOTE_PREFIX_RE.exec(lines[index + 1] ?? '')
      if (next !== null && quoteDepth(next[1] ?? '') >= depth && (next[2] ?? '').trim() !== '') {
        out.push(prefix.trimEnd())
      }
    }
    previousDepth = depth
    previousBlank = content.trim() === ''
  }
  return out.join('\n')
}
