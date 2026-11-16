import { formatUrlEmbedBody, type EmbedLayout } from '@kore/core'
import { TextSelection } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'
import { hostOf } from './link-card-dom'
import { paragraphCardUrl } from './link-card-plugin'

/**
 * Switching how a link draws, as Markdown edits. The four looks map onto
 * plain Markdown so the file stays portable:
 *
 * - **Inline link**: an ordinary `[Title](url)` in its own paragraph (a named
 *   link never draws as a card).
 * - **Card**: a bare pasted URL on its own line, or an ` ```embed ` fence
 *   with just the URL.
 * - **Compact / Large**: an ` ```embed ` fence with a `layout:` line.
 */
export type LinkLook = 'link' | EmbedLayout

/** Where a card's source sits: an embed fence, or a bare-URL paragraph. */
export interface LinkBlock {
  readonly kind: 'fence' | 'paragraph'
  /** The block's position before its opening token. */
  readonly pos: number
}

/** The block a card's element stands for, or null when it cannot be found. */
export function linkBlockAt(view: EditorView, source: Element, url: string): LinkBlock | null {
  const { doc } = view.state
  const custom = source.closest('[data-meowdown-code-block-custom]')
  if (custom !== null) {
    const pre = custom.parentElement?.firstElementChild
    if (!(pre instanceof HTMLElement) || pre.localName !== 'pre') {
      return null
    }
    try {
      const $inside = doc.resolve(view.posAtDOM(pre, 0))
      return $inside.parent.type.name === 'codeBlock'
        ? { kind: 'fence', pos: $inside.before() }
        : null
    } catch {
      return null
    }
  }
  const card = source.closest('.kore-link-card')
  if (card === null) {
    return null
  }
  let pos: number
  try {
    pos = view.posAtDOM(card, 0)
  } catch {
    return null
  }
  const node = doc.nodeAt(pos)
  return node !== null && paragraphCardUrl(node) === url ? { kind: 'paragraph', pos } : null
}

/** `[Title](url)`, with the title's own brackets escaped. */
export function inlineLinkMarkdown(url: string, title: string | null): string {
  const name = (title ?? '').trim() === '' ? hostOf(url) : (title ?? '').trim()
  return `[${name.replaceAll(/[[\]\\]/g, String.raw`\$&`)}](${url})`
}

type InsertMarkdown = (markdown: string) => void

/**
 * Redraw the link at `block` as `look`. `insertMarkdown` is the editor's own
 * command (it parses Markdown into nodes); it replaces the block selected
 * here. Returns false when the block moved away meanwhile.
 */
export function applyLinkLook(
  view: EditorView,
  insertMarkdown: InsertMarkdown,
  block: LinkBlock,
  link: { url: string; title: string | null },
  look: LinkLook,
): boolean {
  const { state } = view
  const node = state.doc.nodeAt(block.pos)
  if (node === null) {
    return false
  }
  if (block.kind === 'fence' && look !== 'link') {
    const from = block.pos + 1
    const body = formatUrlEmbedBody(link.url, look)
    view.dispatch(state.tr.replaceWith(from, from + node.content.size, state.schema.text(body)))
    return true
  }
  if (block.kind === 'paragraph' && look === 'card') {
    return true
  }
  const markdown =
    look === 'link'
      ? inlineLinkMarkdown(link.url, link.title)
      : ['```embed', formatUrlEmbedBody(link.url, look), '```'].join('\n')
  // Swap the block for an empty paragraph with the caret in it, then let the
  // editor parse the Markdown there: selecting the block itself would insert
  // inside a code block instead of replacing it.
  const paragraph = state.schema.nodes.paragraph
  if (paragraph === undefined) {
    return false
  }
  const tr = state.tr.replaceWith(block.pos, block.pos + node.nodeSize, paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, block.pos + 1))
  view.dispatch(tr)
  insertMarkdown(markdown)
  return true
}
