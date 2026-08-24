/**
 * GitHub-style alert callouts (`> [!NOTE]`), portable markdown that any
 * editor can round-trip. meowdown has no callout node, so the host styles
 * the underlying blockquote after parse.
 */

/** Kinds GitHub alerts recognize. `info` in source maps to `note`. */
export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

/** A parsed `> [!NOTE]` (or `> [!NOTE] Title`) marker line. */
export interface CalloutMarker {
  readonly kind: CalloutKind
  /** Optional title after the kind token; null when the line is the kind alone. */
  readonly title: string | null
}

const MARKER_RE = /^\[!(note|tip|important|warning|caution|info)\](?:[ \t]+(.+))?$/i

function kindFromToken(token: string): CalloutKind {
  const folded = token.toLowerCase()
  return folded === 'info' ? 'note' : (folded as CalloutKind)
}

/**
 * Parse a blockquote's first line as a GitHub alert marker. Returns null when
 * the line is ordinary quoted prose.
 */
export function parseCalloutMarker(line: string): CalloutMarker | null {
  const match = MARKER_RE.exec(line.trim())
  if (match === null) {
    return null
  }
  const title = match[2]?.trim() ?? ''
  return { kind: kindFromToken(match[1] ?? 'note'), title: title === '' ? null : title }
}

/** The markdown inserted by the `/` menu for an empty callout of `kind`. */
export function formatCalloutBlock(kind: CalloutKind): string {
  return `> [!${kind.toUpperCase()}]\n> \n`
}
