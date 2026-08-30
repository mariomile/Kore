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

/**
 * Every bare URL standing alone as its own paragraph, as {@link UrlEmbed}s in
 * source order — the "paste a link, get a preview" path. A URL only embeds
 * when the *whole* trimmed line is the URL and the line is its own paragraph
 * (blank or start/end of note on both sides): a URL inside prose, a
 * `[text](url)` link, a list item, a quote, a heading, or anything inside a
 * fenced code block stays a plain link. Lines inside ` ```embed ` fences are
 * inside fences too, so a fence never double-renders through this scan.
 */
export function scanBareUrlEmbeds(markdown: string): UrlEmbed[] {
  const embeds: UrlEmbed[] = []
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  let fenceMark = ''
  const blankAt = (index: number): boolean =>
    index < 0 || index >= lines.length || lines[index]!.trim() === ''
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const trimmed = line.trim()
    const fence = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fence !== null) {
      if (!inFence) {
        inFence = true
        fenceMark = fence[1]![0]!
      } else if (fence[1]![0] === fenceMark) {
        inFence = false
      }
      continue
    }
    if (inFence) {
      continue
    }
    // An indented line is a code block or a nested list continuation.
    if (/^(?: {4}|\t)/.test(line)) {
      continue
    }
    if (!/^https?:\/\/\S+$/.test(trimmed)) {
      continue
    }
    if (!blankAt(index - 1) || !blankAt(index + 1)) {
      continue
    }
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        continue
      }
    } catch {
      continue
    }
    embeds.push({ kind: 'url', url: trimmed, linkKind: linkKind(trimmed) })
  }
  return embeds
}

/** Serialize one embed as the fence that produces it. */
export function formatEmbedBlock(block: EmbedBlock): string {
  const body = block.kind === 'url' ? block.url : block.html
  return ['```embed', body, '```'].join('\n')
}
