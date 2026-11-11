import {
  detectConflictMarkers,
  parseNoteAppearanceFromSource,
  splitFrontmatter,
} from '@kore/core'
import { parseBodyEmbeds } from '@/components/body-embeds'
import { checkRoundTrip } from './roundtrip'

/**
 * Whether a daily note may be drawn as static text while the stream scrolls
 * (see `DailyDay`), and with which body.
 *
 * The static drawing is meowdown's read-only view in the editor's own
 * classes. It matches the editor pixel for pixel on plain writing: text,
 * headings, lists, quotes, wiki links, tags and links. Everything the live
 * pane draws with a part the static view lacks keeps its editor instead, so
 * a row never changes height when its editor takes over:
 *
 * - a cover or an icon in the frontmatter (they sit above the editor),
 * - sync conflict markers and notes the editor opens read-only,
 * - media, note and base embeds under the editor,
 * - images and post embeds (`![`), code fences (collections, diagrams),
 *   math, tables, callouts, raw HTML and attached files.
 *
 * Returns the body to draw, or null when the day needs its editor.
 */
export function staticDayBody(source: string): string | null {
  const { raw, body } = splitFrontmatter(source)
  if (raw !== null) {
    // Frontmatter itself is never drawn; only a cover or an icon is.
    const appearance = parseNoteAppearanceFromSource(source)
    if (appearance.icon !== null || appearance.coverSrc !== null) {
      return null
    }
  }
  if (UNSAFE.test(body) || detectConflictMarkers(body)) {
    return null
  }
  const embeds = parseBodyEmbeds(body)
  if (embeds.media.length > 0 || embeds.transclusions.length > 0 || embeds.bases.length > 0) {
    return null
  }
  // The same gate the session applies before it lets the editor own a note.
  if (body.trim() !== '' && checkRoundTrip(body) === 'lossy') {
    return null
  }
  return body
}

/**
 * One match is enough to keep the editor. Deliberately wide: a false match
 * costs one day its smooth scroll, a miss would make a row jump.
 */
const UNSAFE = new RegExp(
  [
    String.raw`!\[`, // images, `![[embeds]]`, X and YouTube posts
    '^\\s*(?:```|~~~)', // code fences: collections, mermaid, highlighted code
    String.raw`\$\$`, // block math
    String.raw`^\s*\|`, // tables
    String.raw`^\s*>\s*\[!`, // callouts
    '<[a-zA-Z/!]', // raw HTML
    String.raw`\]\(assets/`, // attached files draw as pills
  ].join('|'),
  'm',
)
