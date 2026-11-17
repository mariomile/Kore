import { docToMarkdown } from '@meowdown/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Decoration, DecorationSet } from '@prosekit/pm/view'
import { linePageId, pagePreview, pageTitle } from '@kore/core'
import { isTouchEditorSurface } from '@/lib/platform-surface'
import { blockSelectionKey, withBlockSelection } from './block-selection-plugin'
import { zoomIntoBlockAt } from './block-zoom-plugin'
import { zoomTarget } from './block-zoom-state'
import { targetSpan, type ZoomTarget } from './block-zoom-target'

/**
 * Sub pages drawn as cards (Craft's page blocks). A page is a list item whose
 * first line ends with a hidden `^page-…` id (see core `sub-page.ts`): it
 * stays in the note with its children, the editor shows it as one card (page
 * glyph, title, two lines of what the children say) and a tap zooms into it.
 * Inside the zoom, and while the caret is in it, the item shows as text.
 */

export interface PageBlock {
  readonly pos: number
  readonly node: ProseMirrorNode
  readonly id: string
}

/** The page a list node is, or null. */
export function pageBlockOf(node: ProseMirrorNode, pos: number): PageBlock | null {
  if (node.type.name !== 'list') return null
  const head = node.firstChild
  if (head === null || !head.isTextblock) return null
  const id = linePageId(head.textContent)
  return id === null ? null : { pos, node, id }
}

/** Every page in the document, outer and nested. */
export function pageBlocks(doc: ProseMirrorNode): PageBlock[] {
  const found: PageBlock[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false
    const page = pageBlockOf(node, pos)
    if (page !== null) found.push(page)
    return true
  })
  return found
}

/**
 * The pages drawn as cards: not the zoomed page or any page around the zoom
 * (that is the page being read), and not a page inside another card (its
 * parent's card stands for it).
 */
function collapsedPages(
  doc: ProseMirrorNode,
  zoom: ZoomTarget | null,
  pages: readonly PageBlock[] = pageBlocks(doc),
): PageBlock[] {
  const zoomFrom = zoom === null ? null : zoom.kind === 'list' ? zoom.root : zoom.from
  const shown: PageBlock[] = []
  for (const page of pages) {
    const end = page.pos + page.node.nodeSize
    if (zoomFrom !== null && zoomFrom >= page.pos && zoomFrom < end) continue
    if (shown.some((outer) => outer.pos < page.pos && outer.pos + outer.node.nodeSize >= end)) {
      continue
    }
    shown.push(page)
  }
  return shown
}

/**
 * The innermost page that hides `pos` (closed: the zoom is not inside it),
 * or null. A followed `[[Note#^id]]` into a page opens that page.
 */
export function closedPageAround(
  doc: ProseMirrorNode,
  zoom: ZoomTarget | null,
  pos: number,
): PageBlock | null {
  const zoomFrom = zoom === null ? null : zoom.kind === 'list' ? zoom.root : zoom.from
  let found: PageBlock | null = null
  for (const page of pageBlocks(doc)) {
    const end = page.pos + page.node.nodeSize
    if (pos < page.pos || pos >= end) continue
    if (zoomFrom !== null && zoomFrom >= page.pos && zoomFrom < end) continue
    if (found === null || page.pos > found.pos) found = page
  }
  return found
}

const allowCaretKey = new PluginKey('kore-page-caret-allowed')

/**
 * Let this transaction put the caret inside a collapsed page (block
 * commands that work on the page's first line, then move on).
 */
export function allowCaretInPage(tr: Transaction): Transaction {
  return tr.setMeta(allowCaretKey, true)
}

/**
 * A page's preview, kept per node: ProseMirror reuses an unchanged node, so
 * typing elsewhere in a long note never re-serialises a page's children.
 */
const previews = new WeakMap<ProseMirrorNode, string>()

function previewOf(state: EditorState, node: ProseMirrorNode): string {
  const cached = previews.get(node)
  if (cached !== undefined) return cached
  const preview = pagePreview(childrenMarkdown(state, node))
  previews.set(node, preview)
  return preview
}

function childrenMarkdown(state: EditorState, node: ProseMirrorNode): string {
  const rest: ProseMirrorNode[] = []
  node.forEach((child, _offset, index) => {
    if (index > 0) rest.push(child)
  })
  return rest.length === 0 ? '' : docToMarkdown(state.schema.topNodeType.create(null, rest))
}

function cardElement(
  title: string,
  preview: string,
  rows: readonly SkeletonRow[],
  open: () => void,
): HTMLElement {
  const card = document.createElement('div')
  card.className = 'kore-page-card'
  card.contentEditable = 'false'
  card.setAttribute('role', 'link')
  card.setAttribute('aria-label', `Open ${title}`)
  const glyph = skeletonElement(rows)
  const body = document.createElement('span')
  body.className = 'kore-page-card-body'
  const heading = document.createElement('span')
  heading.className = 'kore-page-card-title'
  heading.textContent = title === '' ? 'Untitled page' : title
  const excerpt = document.createElement('span')
  excerpt.className = 'kore-page-card-excerpt'
  if (rows.length === 0) {
    excerpt.textContent = 'Empty page'
    excerpt.dataset['empty'] = ''
  } else {
    // The page's first blocks as they read inside it: one line each, with
    // its dot, number or box, indented when nested, headings bold.
    let number = 0
    for (const row of rows.slice(0, PREVIEW_LINES)) {
      number = row.kind === 'ordered' ? number + 1 : 0
      const line = document.createElement('span')
      line.className = 'kore-page-card-line'
      line.dataset['kind'] = row.kind
      line.style.setProperty('--depth', String(Math.min(row.depth, 3)))
      if (row.kind === 'ordered') line.dataset['number'] = `${number}.`
      line.textContent = row.text === '' ? ' ' : row.text
      excerpt.append(line)
    }
    if (rows.length > PREVIEW_LINES) excerpt.dataset['more'] = ''
  }
  excerpt.setAttribute('aria-label', preview)
  body.append(heading, excerpt)
  card.append(glyph, body)
  card.addEventListener('click', (event) => {
    event.preventDefault()
    open()
  })
  return card
}

/** One line of a page's thumbnail: what kind of block, how deep, how long. */
export interface SkeletonRow {
  readonly kind: 'heading' | 'text' | 'bullet' | 'ordered' | 'task' | 'done' | 'quote' | 'page'
  readonly depth: number
  /** Share of the line the text fills, 0.3 to 1. */
  readonly width: number
  /** The block's text as a reader sees it. */
  readonly text: string
}

/** How many lines the thumbnail draws: what fits on the glyph. */
const SKELETON_ROWS = 6
/** How many of those the card's preview spells out. */
const PREVIEW_LINES = 4

/**
 * The thumbnail of a page (Craft's page icon is the page in miniature): its
 * first blocks as rows, headings bold, list items with their dot, number or
 * box, nested items indented, a nested page as a small sheet.
 */
export function pageSkeleton(node: ProseMirrorNode): SkeletonRow[] {
  const rows: SkeletonRow[] = []
  const visit = (parent: ProseMirrorNode, depth: number, inQuote: boolean): void => {
    parent.forEach((child, _offset, index) => {
      if (rows.length >= SKELETON_ROWS) return
      if (parent === node && index === 0) return
      if (child.type.name === 'list') {
        const kind =
          pageBlockOf(child, 0) !== null
            ? 'page'
            : child.attrs['kind'] === 'task'
              ? child.attrs['checked'] === true
                ? 'done'
                : 'task'
              : child.attrs['kind'] === 'ordered'
                ? 'ordered'
                : 'bullet'
        const head = child.firstChild
        const text = pageTitle(head?.textContent ?? '')
        rows.push({ kind, depth, width: widthOf(text), text })
        if (kind !== 'page') {
          child.forEach((grand, _o, at) => {
            if (at > 0 && rows.length < SKELETON_ROWS) {
              visit(child.type.schema.topNodeType.create(null, [grand]), depth + 1, inQuote)
            }
          })
        }
        return
      }
      if (child.isTextblock) {
        if (child.textContent.trim() === '') return
        const kind = child.type.name === 'heading' ? 'heading' : inQuote ? 'quote' : 'text'
        const text = pageTitle(child.textContent)
        rows.push({ kind, depth, width: widthOf(text), text })
        return
      }
      visit(child, depth, inQuote || child.type.name === 'blockquote')
    })
  }
  visit(node, 0, false)
  return rows
}

function widthOf(text: string): number {
  return Math.round(Math.min(1, Math.max(0.3, text.trim().length / 36)) * 100) / 100
}

const skeletons = new WeakMap<ProseMirrorNode, SkeletonRow[]>()

function skeletonOf(node: ProseMirrorNode): SkeletonRow[] {
  const cached = skeletons.get(node)
  if (cached !== undefined) return cached
  const rows = pageSkeleton(node)
  skeletons.set(node, rows)
  return rows
}

function skeletonElement(rows: readonly SkeletonRow[]): HTMLElement {
  const sheet = document.createElement('span')
  sheet.className = 'kore-page-card-glyph'
  sheet.setAttribute('aria-hidden', 'true')
  for (const row of rows) {
    const line = document.createElement('span')
    line.className = 'kore-page-skel'
    line.dataset['kind'] = row.kind
    line.style.setProperty('--depth', String(Math.min(row.depth, 2)))
    line.style.setProperty('--width', String(row.width))
    sheet.append(line)
  }
  return sheet
}

/** How a surface opens a page instead of zooming into it in place. */
export interface PageBlockOptions {
  /**
   * Open the page `id` names somewhere else (the phone's daily pushes the
   * note's own screen with the page open). True when it did; false falls
   * back to the zoom in place.
   */
  readonly openPage?: (id: string) => boolean
}

function build(state: EditorState, options: PageBlockOptions): DecorationSet {
  const pages = pageBlocks(state.doc)
  if (pages.length === 0) return DecorationSet.empty
  const zoom = zoomTarget(state)
  const decorations: Decoration[] = []
  for (const page of collapsedPages(state.doc, zoom, pages)) {
    const title = pageTitle(page.node.firstChild?.textContent ?? '')
    const preview = previewOf(state, page.node)
    const rows = skeletonOf(page.node)
    const shape = rows.map((row) => `${row.kind}${row.depth}${row.width}`).join(',')
    decorations.push(
      Decoration.node(
        page.pos,
        page.pos + page.node.nodeSize,
        { class: 'kore-page-block' },
        { page: true },
      ),
      Decoration.widget(
        page.pos + 1,
        // The position is read at tap time: a reused card (same key) may sit
        // elsewhere by then, and two pasted copies can share an id.
        (view, getPos) =>
          cardElement(title, preview, rows, () => {
            if (options.openPage?.(page.id) === true) return
            const at = getPos()
            if (at === undefined) return
            zoomIntoBlockAt(view, at - 1)
            // Opening a page is reading (Craft): on a touch screen the
            // keyboard stays down until a tap on the text.
            if (isTouchEditorSurface() && view.dom instanceof HTMLElement) view.dom.blur()
          }),
        {
          side: -1,
          ignoreSelection: true,
          stopEvent: (event) => event.type === 'click' || event.type === 'mousedown',
          key: `page-card:${page.id}:${title}:${preview}:${shape}`,
        },
      ),
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

const pageBlockKey = new PluginKey<DecorationSet>('kore-page-blocks')

export function createPageBlockPlugin(options: PageBlockOptions = {}): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: pageBlockKey,
    state: {
      init: (_, state) => build(state, options),
      apply(tr, value, old, next) {
        if (!tr.docChanged && zoomTarget(old) === zoomTarget(next)) return value
        return build(next, options)
      },
    },
    // A collapsed page is one card: the caret never lands in its hidden text.
    // Arrowing down steps over it, arrowing up steps back before it, and a
    // zoom out leaves the caret just after the page it came from.
    appendTransaction(trs, old, next) {
      if (trs.some((tr) => tr.getMeta(allowCaretKey) === true)) return null
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null
      const cards = pageBlockKey.getState(next)
      if (cards === undefined) return null
      // The card decorations already are the collapsed pages: look the caret
      // up there instead of walking the document again.
      const cardAt = (pos: number): Decoration | undefined =>
        cards
          .find(pos, pos, (spec: { page?: boolean }) => spec.page === true)
          .find((card) => pos > card.from && pos < card.to)
      const { selection } = next
      if (cardAt(selection.from) === undefined) return null
      // Step over every card in the way (pages can sit back to back), going
      // the way the caret was going, else the other way.
      // Never step out of a zoom: the zoom would clamp the caret back into a
      // card, and the two plugins would bounce it forever.
      const zoom = zoomTarget(next)
      const span = zoom === null ? null : targetSpan(next.doc, zoom)
      const inView = (candidate: Selection): boolean =>
        span === null || (candidate.from > span.from && candidate.to < span.to)
      const step = (dir: 1 | -1): Selection | null => {
        let candidate: Selection = selection
        for (let guard = 0; guard < 1000; guard += 1) {
          const card = cardAt(candidate.from)
          if (card === undefined) return inView(candidate) ? candidate : null
          const edge = dir === 1 ? card.to : card.from
          const moved = Selection.near(next.doc.resolve(edge), dir)
          if (moved.from === candidate.from) return null
          candidate = moved
        }
        return null
      }
      const forward = selection.head >= old.selection.head
      const target = forward ? (step(1) ?? step(-1)) : (step(-1) ?? step(1))
      return target === null ? null : next.tr.setSelection(target)
    },
    props: {
      decorations: (state) => pageBlockKey.getState(state) ?? null,
    },
  })
}

/**
 * The keyboard guard around cards, as its own plugin so it can run before the
 * list keymap (high priority) while the cards themselves stay after the zoom,
 * whose state they read.
 */
export function createPageKeyPlugin(): Plugin {
  return new Plugin({
    props: {
      // Backspace at the start of the line after a card, or Delete at the end
      // of the line before one, would join text into the hidden page (or the
      // page's title onto this line). Select the card instead, as Craft does;
      // a second press deletes it like any selected block.
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false
        if (event.metaKey || event.ctrlKey || event.altKey) return false
        const { selection } = view.state
        if (!selection.empty) return false
        const cards = pageBlockKey.getState(view.state)
        if (cards === undefined || cards === DecorationSet.empty) return false
        const { $from } = selection
        const back = event.key === 'Backspace'
        if (back ? $from.parentOffset !== 0 : $from.parentOffset !== $from.parent.content.size) {
          return false
        }
        const edge = back ? $from.before() : $from.after()
        // The card that ends (or starts) where this line's block meets it,
        // walking out through the list levels around the caret.
        const card = cards
          .find(
            edge - $from.depth * 2,
            edge + $from.depth * 2,
            (spec: { page?: boolean }) => spec.page === true,
          )
          .filter((candidate) => {
            const range = back
              ? { from: candidate.to, to: edge }
              : { from: edge, to: candidate.from }
            if (range.from > range.to) return false
            // Only structure (closing / opening list tokens) between them.
            return (
              view.state.doc.textBetween(range.from, range.to) === '' &&
              !view.state.doc.resolve(range.from).parent.isTextblock
            )
          })
          .sort((a, b) => (back ? b.to - a.to : a.from - b.from))[0]
        if (card === undefined) return false
        // On the phone the card joins the block selection (the grey card and
        // its action bar, as after a swipe); iOS would draw its own blue
        // handles around a node selection.
        if (blockSelectionKey.getState(view.state) !== undefined) {
          view.dispatch(
            withBlockSelection(view.state.tr, {
              type: 'set',
              anchors: [card.from + 2],
            }),
          )
          return true
        }
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, card.from)))
        return true
      },
    },
  })
}
