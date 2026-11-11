import {
  detectConflictMarkers,
  parseNoteAppearanceFromSource,
  splitFrontmatter,
  wikiEmbedKind,
} from '@kore/core'
import { parseBodyEmbeds } from '@/components/body-embeds'
import { checkRoundTrip } from './roundtrip'

/**
 * Whether a daily note may be drawn as static text while the stream scrolls
 * (see `DailyDay`), and with which body.
 *
 * The static drawing is meowdown's read-only view in the editor's own
 * classes. It matches the editor pixel for pixel on plain writing: text,
 * headings, lists, quotes, wiki links, tags, links and images (the static
 * picture is given the editor's box, see `editorImageSize`). Everything the
 * live pane draws with a part the static view lacks keeps its editor
 * instead, so a row never changes height when its editor takes over:
 *
 * - a cover or an icon in the frontmatter (they sit above the editor),
 * - sync conflict markers and notes the editor opens read-only,
 * - media, note and base embeds under the editor,
 * - X and YouTube posts, embedded files, images with a stored size, code
 *   fences (collections, diagrams), math, tables, callouts, raw HTML and
 *   attached files.
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
  const text = withoutPlainImages(body)
  if (text === null || UNSAFE.test(text) || detectConflictMarkers(body)) {
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

/** Meowdown's cap on the height an image without a stored size is drawn at. */
const IMAGE_MAX_HEIGHT = 500

/**
 * The box the editor gives a loaded image (meowdown's
 * `applyImageDisplaySize`): the width its markdown sets, else the natural
 * size scaled down to `IMAGE_MAX_HEIGHT`, rounded up to a whole pixel, at the
 * picture's own ratio. Null for a picture without a size.
 */
export function editorImageSize(
  naturalWidth: number,
  naturalHeight: number,
  setWidth: number | null,
): { width: number; ratio: number } | null {
  const ratio = naturalWidth / naturalHeight
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null
  }
  const width = setWidth ?? Math.min(naturalHeight, IMAGE_MAX_HEIGHT) * ratio
  return { width: Math.ceil(width), ratio }
}

/**
 * One match is enough to keep the editor. Deliberately wide: a false match
 * costs one day its smooth scroll, a miss would make a row jump.
 */
const UNSAFE = new RegExp(
  [
    '^\\s*(?:```|~~~)', // code fences: collections, mermaid, highlighted code
    String.raw`\$\$`, // block math
    String.raw`^\s*\|`, // tables
    String.raw`^\s*>\s*\[!`, // callouts
    '<[a-zA-Z/!]', // raw HTML
    String.raw`\]\(assets/`, // attached files draw as pills
  ].join('|'),
  'm',
)

/**
 * `![alt](src "title")`, capturing the source: either `<in angle brackets>`
 * (spaces allowed) or bare, with one level of balanced parentheses, as in
 * `image (2).jpeg` written `image%20(2).jpeg`.
 */
const MARKDOWN_IMAGE =
  /!\[[^\]\n]*\]\(\s*(?:<([^<>\n]*)>|((?:[^()\s<>]|\([^()\s]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g
/** `![[target|size]]`, capturing what is inside. */
const WIKI_EMBED = /!\[\[([^\]\n]+)\]\]/g
const REMOTE = /^https?:\/\//i
/**
 * Hosts whose image syntax the editor draws as a post card, which the
 * static view leaves out. Wider than meowdown's own matcher on purpose.
 */
const POST_HOST =
  /^https?:\/\/(?:[\w-]+\.)?(?:x\.com|twitter\.com|youtube\.com|youtube-nocookie\.com|youtu\.be)\//i

/**
 * The body with every image both views draw the same way taken out, so the
 * rules above only judge the writing around them: a markdown image of an
 * image file or a remote picture, or a wiki embed of an image file. Null
 * when a `![` is anything else: a post card, a note or file embed, or a
 * shape this does not recognize.
 */
function withoutPlainImages(body: string): string | null {
  if (!body.includes('![')) {
    return body
  }
  let plain = true
  const text = body
    .replaceAll(WIKI_EMBED, (_match, inner: string) => {
      const target = inner.split(/[|#]/)[0] ?? ''
      plain &&= wikiEmbedKind(target.trim()) === 'image'
      return ''
    })
    .replaceAll(MARKDOWN_IMAGE, (_match, angled?: string, bare?: string) => {
      const src = (angled ?? bare ?? '').trim()
      plain &&= REMOTE.test(src) ? !POST_HOST.test(src) : wikiEmbedKind(src) === 'image'
      return ''
    })
  return plain && !text.includes('![') ? text : null
}
