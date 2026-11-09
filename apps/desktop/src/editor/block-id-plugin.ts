import { lineBlockId, newBlockId } from '@reflect/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { targetSpan } from './block-zoom-target'
import { zoomTarget, zoomTo } from './block-zoom-plugin'

/**
 * Obsidian block ids in the live editor (Plan 33 C3). A followed
 * `[[Note#^id]]` lands on the line that ends with `^id` (or, for an id alone
 * on its line, on the block above it) and flashes it. Every marker draws small
 * and muted, so the id stays in the file (Obsidian reads the same links)
 * without crowding the line. The markdown is never touched by this plugin.
 */

interface BlockIdState {
  /** The quiet look of every `^id` marker at the end of a line. */
  readonly markers: DecorationSet
  readonly flash: DecorationSet
}

/** A marker the way {@link lineBlockId} reads it, at the end of a text run. */
const MARKER_RE = /(?:^|[ \t])(\^[\da-z-]+)[ \t]*$/i

/**
 * Inline decorations over every end-of-line `^id`. Only a marker in the
 * textblock's last text node counts: an atom (a wiki link, a tag) after it
 * means the caret is not at the end of the line.
 */
function markerDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true
    }
    const last = node.lastChild
    if (node.type.spec.code === true || last?.isText !== true) {
      return false
    }
    const text = last.text ?? ''
    const match = MARKER_RE.exec(text)
    if (match?.[1] !== undefined) {
      const end = pos + 1 + node.content.size
      const from = end - (text.length - (match.index + match[0].indexOf('^')))
      decorations.push(Decoration.inline(from, from + match[1].length, { class: 'kore-block-id' }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

const blockIdKey = new PluginKey<BlockIdState>('kore-block-ids')
const FLASH_MS = 1600

/** Where a `^id` lives: the textblock to put the caret in, and the block to flash. */
export interface BlockIdHit {
  /** Position of the textblock carrying the id (or the block above an id-only line). */
  readonly caret: number
  /** The flashed node: that textblock, or the whole block above an id-only line. */
  readonly from: number
  readonly to: number
}

/** Find the block `id` names in `doc`, or null when no line carries it. */
export function findBlockId(doc: ProseMirrorNode, id: string): BlockIdHit | null {
  let hit: BlockIdHit | null = null
  doc.descendants((node, pos, parent, index) => {
    if (hit !== null) {
      return false
    }
    if (!node.isTextblock) {
      return true
    }
    if (node.type.spec.code === true || lineBlockId(node.textContent) !== id) {
      return false
    }
    if (node.textContent.trim() === `^${id}` && parent !== null && index > 0) {
      // An id alone on its line names the block just above it.
      const previous = parent.child(index - 1)
      const from = pos - previous.nodeSize
      hit = { caret: from + 1, from, to: pos }
      return false
    }
    hit = { caret: pos + 1, from: pos, to: pos + node.nodeSize }
    return false
  })
  return hit
}

/**
 * Put the caret on the block `id` names, scroll it to the middle of the view
 * and flash it. Steps out of a zoom that hides it. False when the note has no
 * such id.
 */
export function revealBlockId(view: EditorView, id: string): boolean {
  const hit = findBlockId(view.state.doc, id)
  if (hit === null) {
    return false
  }
  const zoom = zoomTarget(view.state)
  if (zoom !== null) {
    const span = targetSpan(view.state.doc, zoom)
    if (span === null || hit.from < span.from || hit.to > span.to) {
      zoomTo(view, null)
    }
  }
  const { state } = view
  const caret = Math.min(hit.caret, state.doc.content.size)
  const tr = state.tr
    .setSelection(TextSelection.near(state.doc.resolve(caret)))
    .setMeta(blockIdKey, { flash: { from: hit.from, to: hit.to } })
  view.dispatch(tr)
  const element = view.nodeDOM(hit.from)
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: 'center' })
  }
  return true
}

function flashDecorations(
  state: EditorState,
  range: { from: number; to: number } | null,
): DecorationSet {
  if (range === null || range.to > state.doc.content.size) {
    return DecorationSet.empty
  }
  return DecorationSet.create(state.doc, [
    Decoration.node(range.from, range.to, { class: 'kore-block-flash' }),
  ])
}

/**
 * Where "Copy link to line" adds its id: the textblock a block starts with
 * (a list item's own line, a paragraph, a heading), or, for a block that has
 * no such line (a code block, a table), an id-only line under it.
 */
type IdPlace =
  | { readonly kind: 'line'; readonly pos: number; readonly node: ProseMirrorNode }
  | { readonly kind: 'below'; readonly after: number; readonly next: ProseMirrorNode | null }

function firstTextblock(
  node: ProseMirrorNode,
  pos: number,
): { node: ProseMirrorNode; pos: number } | null {
  if (node.isTextblock) {
    return { node, pos }
  }
  const first = node.firstChild
  // A table's first cell is not "the line": the table gets an id-only line.
  if (first === null || node.type.spec.tableRole !== undefined) {
    return null
  }
  return firstTextblock(first, pos + 1)
}

function idPlaceAt(doc: ProseMirrorNode, pos: number): IdPlace | null {
  if (pos < 0 || pos >= doc.content.size) {
    return null
  }
  const $pos = doc.resolve(pos)
  const node = doc.nodeAt(pos)
  if (node === null) {
    return null
  }
  const line = node.isInline ? null : firstTextblock(node, pos)
  if (line !== null && line.node.type.spec.code !== true) {
    return { kind: 'line', pos: line.pos, node: line.node }
  }
  // Code and tables: Obsidian ids the block from a line of its own under it.
  const top = $pos.depth === 0 ? pos : $pos.before(1)
  const topNode = doc.nodeAt(top)
  if (topNode === null) {
    return null
  }
  const after = top + topNode.nodeSize
  return { kind: 'below', after, next: doc.nodeAt(after) }
}

/** The block start of the caret's line, for commands run on the selection. */
function caretBlockStart(state: EditorState): number {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.isTextblock && node.type.spec.code !== true) {
      return $from.before(depth)
    }
  }
  return $from.depth === 0 ? $from.pos : $from.before(1)
}

/**
 * The `^id` of the block starting at `pos`, adding one (six letters or
 * digits, unique in the note) to that line only when it has none. Null when
 * there is no block there. The edit is one undoable transaction.
 */
export function ensureBlockIdAt(view: EditorView, pos: number): string | null {
  const { state } = view
  const place = idPlaceAt(state.doc, pos)
  if (place === null) {
    return null
  }
  if (place.kind === 'line') {
    const existing = lineBlockId(place.node.textContent)
    if (existing !== null && place.node.lastChild?.isText === true) {
      return existing
    }
  } else if (place.next?.isTextblock === true) {
    const existing = place.next.textContent.trim()
    if (/^\^[\da-z-]+$/i.test(existing)) {
      return existing.slice(1)
    }
  }
  const taken = new Set(blockIdsInDoc(state.doc))
  let id = newBlockId()
  while (taken.has(id)) {
    id = newBlockId()
  }
  if (place.kind === 'line') {
    const end = place.pos + place.node.nodeSize - 1
    const text = place.node.textContent
    const gap = text === '' || /\s$/.test(text) ? '' : ' '
    view.dispatch(state.tr.insertText(`${gap}^${id}`, end))
  } else {
    const paragraph = state.schema.nodes.paragraph?.create(null, state.schema.text(`^${id}`))
    if (paragraph === undefined) {
      return null
    }
    view.dispatch(state.tr.insert(place.after, paragraph))
  }
  return id
}

/** {@link ensureBlockIdAt} for the caret's block. */
export function ensureBlockIdAtCaret(view: EditorView): string | null {
  return ensureBlockIdAt(view, caretBlockStart(view.state))
}

function blockIdsInDoc(doc: ProseMirrorNode): string[] {
  const ids: string[] = []
  doc.descendants((node) => {
    if (!node.isTextblock) {
      return true
    }
    const id = lineBlockId(node.textContent)
    if (id !== null) {
      ids.push(id)
    }
    return false
  })
  return ids
}

export interface BlockIdOptions {
  /**
   * The wiki target other notes link this note by (its title, or its date
   * for a daily note), or null when it has none yet: "Copy link to line" is
   * offered only with one.
   */
  readonly linkTarget?: () => string | null
}

const linkTargets = new WeakMap<EditorView, () => string | null>()
let lastFocusedView: EditorView | null = null

/** The `[[Note#^id]]` text for a line, or null when the note has no link target. */
export function blockLinkText(view: EditorView, id: string): string | null {
  const target = linkTargets.get(view)?.()
  return target === undefined || target === null || target === '' ? null : `[[${target}#^${id}]]`
}

/** Whether this editor can copy a link to one of its lines. */
export function canLinkToBlock(view: EditorView): boolean {
  const target = linkTargets.get(view)?.()
  return target !== undefined && target !== null && target !== ''
}

/** The editor that last had focus, for "Copy link to line" run from the palette. */
export function lastFocusedBlockIdView(): EditorView | null {
  return lastFocusedView !== null && !lastFocusedView.isDestroyed ? lastFocusedView : null
}

/** The plugin behind `^id` markers, arrival flashes and "Copy link to line". */
export function createBlockIdPlugin(options: BlockIdOptions = {}): Plugin<BlockIdState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Plugin<BlockIdState>({
    key: blockIdKey,
    state: {
      init: (_config, state) => ({
        markers: markerDecorations(state.doc),
        flash: DecorationSet.empty,
      }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(blockIdKey) as
          | { flash: { from: number; to: number } | null }
          | undefined
        const markers = tr.docChanged ? markerDecorations(tr.doc) : value.markers
        if (meta !== undefined) {
          return { markers, flash: flashDecorations(state, meta.flash) }
        }
        return tr.docChanged ? { markers, flash: value.flash.map(tr.mapping, tr.doc) } : value
      },
    },
    props: {
      decorations(state) {
        const value = blockIdKey.getState(state)
        if (value === undefined) {
          return null
        }
        return value.flash === DecorationSet.empty
          ? value.markers
          : value.markers.add(state.doc, value.flash.find())
      },
    },
    view: (editorView) => {
      if (options.linkTarget !== undefined) {
        linkTargets.set(editorView, options.linkTarget)
      }
      if (editorView.hasFocus()) {
        lastFocusedView = editorView
      }
      return {
        update(view, previous) {
          if (view.hasFocus()) {
            lastFocusedView = view
          }
          const before = blockIdKey.getState(previous)?.flash
          const after = blockIdKey.getState(view.state)?.flash
          if (after === undefined || after === before || after === DecorationSet.empty) {
            return
          }
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (!view.isDestroyed) {
              view.dispatch(view.state.tr.setMeta(blockIdKey, { flash: null }))
            }
          }, FLASH_MS)
        },
        destroy() {
          clearTimeout(timer)
          linkTargets.delete(editorView)
          if (lastFocusedView === editorView) {
            lastFocusedView = null
          }
        },
      }
    },
  })
}
