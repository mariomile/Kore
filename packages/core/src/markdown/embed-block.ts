import { linkKind, type LinkKind } from './link-kind'

/**
 * Embed blocks: a fenced ` ```embed ` block in a note body holds either one
 * URL or a snippet of raw HTML, and the editor draws it in place of the
 * fence, where it sits in the note — the same markdown-backed widget
 * contract Collections use. The fence is
 * the portable source of truth: any other markdown editor shows a code block
 * with the URL or the markup inside it, nothing is lost, and nothing is
 * invented outside the file.
 *
 * Two shapes, told apart by the body's first character:
 *
 * - **A URL** renders as a typed preview card ({@link linkKind}) — a video, a
 *   repository and an article stop looking alike.
 * - **Raw HTML** renders in a sandboxed frame — the escape hatch for the
 *   embeds that have no first-class renderer yet (a widget, a third-party
 *   iframe), instead of a dead link.
 */

/**
 * How a URL embed draws: a one-line `compact` row, the default rich `card`,
 * or a `large` card with the image across the top. (The fourth look, a plain
 * inline link, is not an embed at all: it is an ordinary Markdown link.)
 */
export type EmbedLayout = 'compact' | 'card' | 'large'

export const EMBED_LAYOUTS: readonly EmbedLayout[] = ['compact', 'card', 'large']

/** A URL embed: one link, rendered as its classified kind. */
export interface UrlEmbed {
  readonly kind: 'url'
  readonly url: string
  /** What the URL points at, resolved once at parse time. */
  readonly linkKind: LinkKind
  /** How it draws; `card` when the fence does not say. */
  readonly layout: EmbedLayout
}

/** A raw-HTML embed: markup the host renders inside a sandboxed frame. */
export interface HtmlEmbed {
  readonly kind: 'html'
  readonly html: string
}

/** One ` ```embed ` fence parsed out of a note body. */
export type EmbedBlock = UrlEmbed | HtmlEmbed

const FENCE_RE = /^```embed[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm

/** Cap on the markup one fence may carry into a frame. */
const MAX_HTML_CHARS = 20_000

/**
 * One ` ```embed ` fence body as the block it renders, or `null` when it is
 * malformed and stays visible as code. The editor draws each fence where it
 * sits from this, the same way it draws a ` ```collection ` fence.
 */
export function parseEmbedFenceBody(body: string): EmbedBlock | null {
  const trimmed = body.trim()
  if (trimmed === '') {
    return null
  }
  if (trimmed.startsWith('<')) {
    return trimmed.length > MAX_HTML_CHARS ? null : { kind: 'html', html: trimmed }
  }
  // A URL embed is exactly one URL, optionally followed by one
  // `layout: compact|card|large` line. Anything else means the author meant
  // something else, and guessing which line to embed would be worse than
  // leaving the fence as visible code.
  const [url = '', layoutLine, ...rest] = trimmed.split(/\r?\n/).map((line) => line.trim())
  if (rest.length > 0 || /\s/.test(url)) {
    return null
  }
  let layout: EmbedLayout = 'card'
  if (layoutLine !== undefined) {
    const match = /^layout:\s*(\w+)$/.exec(layoutLine)
    const named = EMBED_LAYOUTS.find((candidate) => candidate === match?.[1])
    if (named === undefined) {
      return null
    }
    layout = named
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
  } catch {
    return null
  }
  return { kind: 'url', url, linkKind: linkKind(url), layout }
}

/**
 * Every well-formed ` ```embed ` fence in `markdown`, in source order.
 * Malformed fences — empty, several URLs, markup past the cap — are skipped
 * and stay visible as code in the editor rather than becoming a broken
 * widget, the same rule ` ```collection ` follows.
 */
export function parseEmbedBlocks(markdown: string): EmbedBlock[] {
  const blocks: EmbedBlock[] = []
  for (const match of markdown.matchAll(FENCE_RE)) {
    const parsed = parseEmbedFenceBody(match[1] ?? '')
    if (parsed !== null) {
      blocks.push(parsed)
    }
  }
  return blocks
}

/** The fence body for a URL embed: the URL, then its layout unless `card`. */
export function formatUrlEmbedBody(url: string, layout: EmbedLayout): string {
  return layout === 'card' ? url : `${url}\nlayout: ${layout}`
}

/** Serialize one embed as the fence that produces it. */
export function formatEmbedBlock(block: EmbedBlock): string {
  const body = block.kind === 'url' ? formatUrlEmbedBody(block.url, block.layout) : block.html
  return ['```embed', body, '```'].join('\n')
}
