import { linkKind, type LinkKind } from './link-kind'

/**
 * Embed blocks: a fenced ` ```embed ` block in a note body holds either one
 * URL or a snippet of raw HTML, and the app renders it underneath the editor
 * — the same markdown-backed widget contract Collections use. The fence is
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

/** A URL embed: one link, rendered as its classified kind. */
export interface UrlEmbed {
  readonly kind: 'url'
  readonly url: string
  /** What the URL points at, resolved once at parse time. */
  readonly linkKind: LinkKind
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

function parseEmbedBody(body: string): EmbedBlock | null {
  const trimmed = body.trim()
  if (trimmed === '') {
    return null
  }
  if (trimmed.startsWith('<')) {
    return trimmed.length > MAX_HTML_CHARS ? null : { kind: 'html', html: trimmed }
  }
  // A URL embed is exactly one URL: extra lines mean the author meant
  // something else, and guessing which line to embed would be worse than
  // leaving the fence as visible code.
  if (/\s/.test(trimmed)) {
    return null
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
  } catch {
    return null
  }
  return { kind: 'url', url: trimmed, linkKind: linkKind(trimmed) }
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
    const parsed = parseEmbedBody(match[1] ?? '')
    if (parsed !== null) {
      blocks.push(parsed)
    }
  }
  return blocks
}

/** Serialize one embed as the fence that produces it. */
export function formatEmbedBlock(block: EmbedBlock): string {
  const body = block.kind === 'url' ? block.url : block.html
  return ['```embed', body, '```'].join('\n')
}
