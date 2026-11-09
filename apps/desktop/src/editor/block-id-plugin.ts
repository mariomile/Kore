import { lineBlockId, newBlockId } from '@reflect/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Mapping } from '@prosekit/pm/transform'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { targetSpan } from './block-zoom-target'
import { clearZoom, zoomTarget } from './block-zoom-plugin'

/**
 * Obsidian block ids in the live editor (Plan 33 C3). A followed
 * `[[Note#^id]]` lands on the line that ends with `^id` (or, for an id alone
 * on its line, on the block above it) and flashes it. The `^id` stays in the
 * file, so Obsidian reads the same links, but the editor never shows it: the
 * marker is hidden and the caret steps around it, so typing, Enter and Delete
 * at the end of the line never break or move the id. The markdown is never
 * touched by this plugin.
 */

interface BlockIdState {
  /** Hides every `^id` marker (and every id-only line). */
  readonly markers: DecorationSet
  readonly flash: DecorationSet
}

/** A marker the way {@link lineBlockId} reads it, at the end of a text run. */
const MARKER_RE = /(?:^|[ \t])\^[\da-z-]+[ \t]*$/i
const ID_ONLY_RE = /^[ \t]*\^[\da-z-]+[ \t]*$/i

/**
 * The hidden tail of a textblock: from the whitespace before its `^id` to the
 * end of the line. Only a marker in the textblock's last text node counts: an
 * atom (a wiki link, a tag) after it means it is not at the end of the line.
 */
interface HiddenMarker {
  /** First hidden position: the caret's visible end of the line. */
  readonly from: number
  /** End of the textblock's content. */
  readonly to: number
  /** The whole line is the id (Obsidian's id for the block above). */
  readonly idOnly: boolean
}

function hiddenMarker(node: ProseMirrorNode, pos: number): HiddenMarker | null {
  const last = node.lastChild
  if (!node.isTextblock || node.type.spec.code === true || last?.isText !== true) {
    return null
  }
  const text = last.text ?? ''
  const match = MARKER_RE.exec(text)
  if (match === null) {
    return null
  }
  const to = pos + 1 + node.content.size
  return {
    from: to - (text.length - match.index),
    to,
    idOnly: ID_ONLY_RE.test(node.textContent),
  }
}

/** The hidden marker of the caret's textblock, when the caret's line has one. */
function markerAtCaret(state: EditorState): HiddenMarker | null {
  const { $from } = state.selection
  return $from.parent.isTextblock ? hiddenMarker($from.parent, $from.before()) : null
}

function markerDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) {
      return true
    }
    const marker = hiddenMarker(node, pos)
    if (marker !== null) {
      // An id-only paragraph between blocks names the block above: the whole
      // line goes. Inside a list it is that item's own line, so only the
      // marker does.
      decorations.push(
        marker.idOnly && parent === doc
          ? Decoration.node(pos, pos + node.nodeSize, { class: 'kore-block-id-line' })
          : Decoration.inline(
              marker.from,
              marker.to,
              { class: 'kore-block-id' },
              { kind: 'inline' },
            ),
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * After an edit that joined a line onto the end of a line with an id
 * (Backspace at the start of the next line, a paste, an agent's edit), the id
 * would sit mid-line: links to it would break and the joined text would hide
 * with it. Move each such marker back to the end of its line. Null when no
 * marker moved.
 */
function keepMarkersAtLineEnd(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const before = blockIdKey.getState(oldState)?.markers
  if (before === undefined || before === DecorationSet.empty) {
    return null
  }
  const mapping = new Mapping()
  for (const tr of transactions) {
    mapping.appendMapping(tr.mapping)
  }
  const tr = newState.tr
  for (const marker of before.find()) {
    if ((marker.spec as { kind?: string }).kind !== 'inline') {
      continue
    }
    const text = oldState.doc.textBetween(marker.from, marker.to)
    const from = mapping.mapResult(marker.from, 1)
    const to = mapping.mapResult(marker.to, -1)
    if (from.deleted || to.deleted || to.pos - from.pos !== text.length) {
      continue
    }
    const start = tr.mapping.map(from.pos)
    const end = tr.mapping.map(to.pos)
    const $end = tr.doc.resolve(end)
    if (!$end.parent.isTextblock || end >= $end.end() || tr.doc.textBetween(start, end) !== text) {
      continue
    }
    const lineEnd = $end.end()
    tr.insertText(text, lineEnd).delete(start, end)
  }
  return tr.docChanged ? tr.setMeta(SKIP_CLAMP, true) : null
}

/** A selection change this plugin makes itself, which the caret rule leaves alone. */
const SKIP_CLAMP = 'kore-block-id-skip-clamp'

/**
 * Keep an empty caret out of hidden text: inside a marker it sits at the
 * line's visible end, and on an id-only line it moves to the nearest visible
 * line in the direction it was going.
 */
function clampCaret(oldState: EditorState, newState: EditorState): TextSelection | null {
  const { selection } = newState
  if (!selection.empty || !(selection instanceof TextSelection)) {
    return null
  }
  const marker = markerAtCaret(newState)
  if (marker === null || selection.head <= marker.from) {
    return null
  }
  const { $from } = selection
  if (marker.idOnly && $from.depth === 1) {
    const forward = selection.head >= oldState.selection.head
    const target = forward ? $from.after() : $from.before()
    const near = TextSelection.near(newState.doc.resolve(target), forward ? 1 : -1)
    return near instanceof TextSelection && near.head !== selection.head ? near : null
  }
  return TextSelection.create(newState.doc, marker.from)
}

/**
 * Keys that must act on the real end of the line, not the visible one: Enter
 * splits after the id (the id stays on its line), and → leaves the line
 * instead of stepping into the hidden text. Delete is handled by the plugin
 * (it carries the id to the end of the joined line).
 */
function handleMarkerKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
    return false
  }
  if (event.key === 'Backspace') {
    return skipHiddenLineBackward(view)
  }
  if (event.key !== 'Enter' && event.key !== 'ArrowRight') {
    return false
  }
  const { state } = view
  const { selection } = state
  const marker = markerAtCaret(state)
  if (!selection.empty || marker === null || selection.head !== marker.from) {
    return false
  }
  if (event.key === 'ArrowRight') {
    const near = TextSelection.near(state.doc.resolve(selection.$from.after()), 1)
    if (near.head <= marker.to) {
      return false
    }
    view.dispatch(state.tr.setSelection(near).scrollIntoView())
    return true
  }
  // Move to the real end, then let the editor's own Enter run there.
  view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, marker.to)).setMeta(SKIP_CLAMP, true),
  )
  return false
}

/**
 * Backspace at the start of a line right under a hidden id-only line would
 * join into the hidden line (and hide the text with it). Treat the hidden line
 * as a wall instead: the caret moves to the end of the block above it.
 */
function skipHiddenLineBackward(view: EditorView): boolean {
  const { state } = view
  const { $from, empty } = state.selection
  if (!empty || $from.depth !== 1 || $from.parentOffset !== 0) {
    return false
  }
  const index = $from.index(0)
  if (index === 0) {
    return false
  }
  const previous = state.doc.child(index - 1)
  const start = $from.before() - previous.nodeSize
  const marker = hiddenMarker(previous, start)
  if (marker === null || !marker.idOnly) {
    return false
  }
  const near = TextSelection.near(state.doc.resolve(start), -1)
  view.dispatch(state.tr.setSelection(near).setMeta(SKIP_CLAMP, true).scrollIntoView())
  return true
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
  const { state } = view
  const caret = Math.min(hit.caret, state.doc.content.size)
  const tr = state.tr
  const zoom = zoomTarget(state)
  if (zoom !== null) {
    const span = targetSpan(state.doc, zoom)
    if (span === null || hit.from < span.from || hit.to > span.to) {
      // Leave the zoom in this same transaction, so the caret lands on the
      // line instead of being clamped back into the zoomed block.
      clearZoom(tr)
    }
  }
  tr.setSelection(TextSelection.near(state.doc.resolve(caret))).setMeta(blockIdKey, {
    flash: { from: hit.from, to: hit.to },
  })
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
  // A zoom refuses edits outside it (an id line under a zoomed code block):
  // no id was written, so there is nothing to link to.
  return view.state.doc === state.doc ? null : id
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
  /**
   * Delete at a line's visible end joins the next line, which would land
   * after the id and break it. The marker is lifted off first and put back at
   * the end of whatever line the caret is on once the editor's own Delete has
   * run (or right away when it did nothing).
   */
  let lifted: { text: string; at: number } | null = null
  const putBack = (state: EditorState, at: number, text: string) => {
    const $at = state.doc.resolve(Math.min(at, state.doc.content.size))
    const end = $at.parent.isTextblock ? $at.end() : at
    const tr = state.tr.insertText(text, end).setMeta(SKIP_CLAMP, true)
    // The caret stays on the visible side of the marker it just got back.
    if (state.selection.empty) {
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(state.selection.head, -1)))
    }
    return tr
  }
  const handleDelete = (view: EditorView, event: KeyboardEvent): boolean => {
    if (
      event.key !== 'Delete' ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return false
    }
    const { state } = view
    const marker = markerAtCaret(state)
    if (!state.selection.empty || marker === null || state.selection.head !== marker.from) {
      return false
    }
    const text = state.doc.textBetween(marker.from, marker.to)
    view.dispatch(state.tr.delete(marker.from, marker.to).setMeta(SKIP_CLAMP, true))
    lifted = { text, at: marker.from }
    queueMicrotask(() => {
      const pending = lifted
      lifted = null
      if (pending !== null && !view.isDestroyed) {
        view.dispatch(putBack(view.state, pending.at, pending.text))
      }
    })
    return false
  }
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
    appendTransaction(transactions, oldState, newState) {
      if (lifted !== null && transactions.some((tr) => tr.docChanged)) {
        let at = lifted.at
        for (const tr of transactions) {
          at = tr.mapping.map(at, -1)
        }
        const { text } = lifted
        lifted = null
        return putBack(newState, at, text)
      }
      if (transactions.some((tr) => tr.docChanged)) {
        const kept = keepMarkersAtLineEnd(transactions, oldState, newState)
        if (kept !== null) {
          return kept
        }
      }
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) {
        return null
      }
      if (transactions.some((tr) => tr.getMeta(SKIP_CLAMP) === true)) {
        return null
      }
      const clamped = clampCaret(oldState, newState)
      return clamped === null ? null : newState.tr.setSelection(clamped)
    },
    props: {
      handleKeyDown: (view, event) => handleDelete(view, event) || handleMarkerKey(view, event),
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
