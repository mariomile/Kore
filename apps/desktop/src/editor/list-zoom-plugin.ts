import type { Node as ProseMirrorNode, ResolvedPos } from '@prosekit/pm/model'
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'

/**
 * Zoom into a list item (Plan 33, C1): the editor shows only that item and
 * its children, with a breadcrumb back up. Everything here is decorations and
 * selection clamping over meowdown's flat `list` nodes, so the document, and
 * therefore the Markdown file, is never touched by zooming.
 */

/** Plugin state: the position just before the zoomed `list` node, if any. */
interface ListZoomState {
  readonly root: number | null
}

const listZoomKey = new PluginKey<ListZoomState>('kore-list-zoom')

function isList(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.name === 'list'
}

function readZoomMeta(tr: Transaction): { readonly root: number | null } | null {
  const meta: unknown = tr.getMeta(listZoomKey)
  if (typeof meta !== 'object' || meta === null || !('root' in meta)) {
    return null
  }
  return typeof meta.root === 'number' || meta.root === null ? { root: meta.root } : null
}

/** The zoomed item's position, or null when the editor shows the whole note. */
export function zoomedListPos(state: EditorState): number | null {
  return listZoomKey.getState(state)?.root ?? null
}

/** The innermost `list` node around `$pos`, as the position just before it. */
function enclosingListPos($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (isList($pos.node(depth))) {
      return $pos.before(depth)
    }
  }
  return null
}

/** The nearest `list` ancestor of the item at `root`, if it is nested. */
function parentListPos(doc: ProseMirrorNode, root: number): number | null {
  const $root = doc.resolve(root)
  return $root.depth === 0 ? null : enclosingListPos($root)
}

/** The range of positions inside the zoomed item that the caret may use. */
function zoomBounds(doc: ProseMirrorNode, root: number): { from: number; to: number } | null {
  const node = doc.nodeAt(root)
  if (!isList(node)) {
    return null
  }
  return { from: root + 1, to: root + node.nodeSize - 1 }
}

function setZoom(tr: Transaction, root: number | null): Transaction {
  tr.setMeta(listZoomKey, { root })
  if (root === null) {
    return tr.scrollIntoView()
  }
  const bounds = zoomBounds(tr.doc, root)
  if (bounds !== null) {
    const { from, to } = tr.selection
    if (from < bounds.from || to > bounds.to) {
      tr.setSelection(Selection.near(tr.doc.resolve(bounds.from + 1)))
    }
  }
  return tr.scrollIntoView()
}

/** Zoom into the list item at `root` (a position just before a `list` node). */
export function zoomToListItem(view: EditorView, root: number | null): void {
  if (root !== null && !isList(view.state.doc.nodeAt(root))) {
    return
  }
  view.dispatch(setZoom(view.state.tr, root))
}

/** Zoom into the innermost list item around the caret. */
export const zoomIn: Command = (state, dispatch) => {
  const root = enclosingListPos(state.selection.$from)
  if (root === null || root === zoomedListPos(state)) {
    return false
  }
  dispatch?.(setZoom(state.tr, root))
  return true
}

/** Zoom out one level: to the parent item, or back to the whole note. */
export const zoomOut: Command = (state, dispatch) => {
  const root = zoomedListPos(state)
  if (root === null) {
    return false
  }
  dispatch?.(setZoom(state.tr, parentListPos(state.doc, root)))
  return true
}

/** The first textblock of a list item: the line its bullet sits on. */
function itemLine(item: ProseMirrorNode): ProseMirrorNode | null {
  const first = item.firstChild
  return first?.isTextblock === true ? first : null
}

/**
 * Keys that would carry an edit out of the zoomed branch are absorbed while
 * the caret is on the zoomed item's own line: Enter at its end opens a first
 * child instead of a sibling the zoom would hide, and the structural moves
 * (indent, outdent, move up/down, join backwards) do nothing.
 */
function onRootLine(state: EditorState): {
  root: number
  item: ProseMirrorNode
  lineEnd: number
} | null {
  const root = zoomedListPos(state)
  if (root === null) {
    return null
  }
  const item = state.doc.nodeAt(root)
  if (!isList(item)) {
    return null
  }
  const line = itemLine(item)
  if (line === null) {
    return null
  }
  const lineStart = root + 2
  const lineEnd = lineStart + line.content.size
  const { from, to } = state.selection
  return from >= lineStart && to <= lineEnd ? { root, item, lineEnd } : null
}

const enterOnRoot: Command = (state, dispatch) => {
  const line = onRootLine(state)
  if (line === null) {
    return false
  }
  if (state.selection.empty && state.selection.from === line.lineEnd && dispatch) {
    const paragraph = state.schema.nodes['paragraph']
    if (paragraph === undefined) {
      return true
    }
    const child = state.schema.nodes['list']?.create(
      { kind: 'bullet', collapsed: false },
      paragraph.create(),
    )
    if (child === undefined) {
      return true
    }
    const insertAt = line.lineEnd + 1
    const tr = state.tr.insert(insertAt, child)
    dispatch(tr.setSelection(TextSelection.create(tr.doc, insertAt + 2)).scrollIntoView())
  }
  return true
}

const absorbOnRoot: Command = (state) => onRootLine(state) !== null

const backspaceOnRoot: Command = (state) => {
  const line = onRootLine(state)
  return line !== null && state.selection.empty && state.selection.from === line.root + 2
}

/** Forward-delete at the very end of the branch would join the next, hidden block. */
const deleteAtBranchEnd: Command = (state) => {
  const root = zoomedListPos(state)
  if (root === null || !state.selection.empty) {
    return false
  }
  const end = Selection.findFrom(
    state.doc.resolve(root + (state.doc.nodeAt(root)?.nodeSize ?? 0)),
    -1,
    true,
  )
  return end !== null && end.from === state.selection.from
}

/** The editor keymap the zoom installs (see `REFLECT_EDITOR_BINDINGS`). */
export const LIST_ZOOM_IN_BINDING = 'Mod-Shift-.'
export const LIST_ZOOM_OUT_BINDING = 'Mod-Shift-,'

export const listZoomKeymap: Readonly<Record<string, Command>> = {
  [LIST_ZOOM_IN_BINDING]: zoomIn,
  [LIST_ZOOM_OUT_BINDING]: zoomOut,
  Enter: enterOnRoot,
  Tab: absorbOnRoot,
  'Shift-Tab': absorbOnRoot,
  'Alt-ArrowUp': absorbOnRoot,
  'Alt-ArrowDown': absorbOnRoot,
  Backspace: backspaceOnRoot,
  Delete: deleteAtBranchEnd,
}

function crumbLabel(node: ProseMirrorNode): string {
  const text = node.textContent.trim()
  return text === '' ? 'Untitled' : text
}

function breadcrumb(view: EditorView, root: number): HTMLElement {
  const { doc } = view.state
  const nav = document.createElement('nav')
  nav.className = 'kore-zoom-breadcrumb'
  nav.contentEditable = 'false'
  nav.setAttribute('aria-label', 'Zoomed list item')

  const crumbs: { label: string; target: number | null }[] = []
  const title = doc.firstChild
  crumbs.push({
    label: title?.type.name === 'heading' ? crumbLabel(title) : 'Note',
    target: null,
  })
  const ancestors: number[] = []
  for (let pos = parentListPos(doc, root); pos !== null; pos = parentListPos(doc, pos)) {
    ancestors.unshift(pos)
  }
  for (const pos of ancestors) {
    const line = itemLine(doc.nodeAt(pos) ?? doc)
    crumbs.push({ label: line === null ? 'Untitled' : crumbLabel(line), target: pos })
  }

  for (const [index, crumb] of crumbs.entries()) {
    if (index > 0) {
      const separator = document.createElement('span')
      separator.className = 'kore-zoom-separator'
      separator.setAttribute('aria-hidden', 'true')
      separator.textContent = '›'
      nav.append(separator)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'kore-zoom-crumb'
    button.textContent = crumb.label
    button.title = crumb.label
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      zoomToListItem(view, crumb.target)
      view.focus()
    })
    nav.append(button)
  }
  return nav
}

function buildDecorations(state: EditorState, root: number): DecorationSet {
  const { doc } = state
  const item = doc.nodeAt(root)
  if (!isList(item)) {
    return DecorationSet.empty
  }
  const decorations: Decoration[] = []
  const $root = doc.resolve(root)
  for (let depth = 0; depth <= $root.depth; depth += 1) {
    const parent = $root.node(depth)
    const keep = $root.index(depth)
    const contentStart = depth === 0 ? 0 : $root.start(depth)
    parent.forEach((child, offset, index) => {
      if (index !== keep) {
        const from = contentStart + offset
        decorations.push(
          Decoration.node(from, from + child.nodeSize, { class: 'kore-zoom-hidden' }),
        )
      }
    })
    if (depth > 0) {
      const from = $root.before(depth)
      decorations.push(
        Decoration.node(from, from + parent.nodeSize, { class: 'kore-zoom-ancestor' }),
      )
    }
  }
  decorations.push(
    Decoration.node(root, root + item.nodeSize, {
      class: 'kore-zoom-root',
      'data-zoom-root': '',
    }),
  )
  decorations.push(
    Decoration.widget(root, (view) => breadcrumb(view, root), {
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
      key: `zoom-breadcrumb:${root}`,
    }),
  )
  return DecorationSet.create(doc, decorations)
}

/** The list item a marker element belongs to, as the position before it. */
function markerListPos(view: EditorView, marker: Element): number | null {
  const listElement = marker.parentElement
  if (listElement === null) {
    return null
  }
  let inside: number
  try {
    inside = view.posAtDOM(listElement, 0)
  } catch {
    return null
  }
  const $inside = view.state.doc.resolve(inside)
  for (let depth = $inside.depth; depth > 0; depth -= 1) {
    const before = $inside.before(depth)
    if (view.nodeDOM(before) === listElement) {
      return before
    }
  }
  return null
}

/** ⌘-click (Ctrl-click off macOS) on a bullet zooms into it; a plain click keeps folding. */
function handleMarkerMouseDown(view: EditorView, event: MouseEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
    return false
  }
  const target = event.target
  if (!(target instanceof Element)) {
    return false
  }
  const marker = target.closest('.list-marker')
  if (marker === null || !view.dom.contains(marker)) {
    return false
  }
  const root = markerListPos(view, marker)
  if (root === null) {
    return false
  }
  event.preventDefault()
  zoomToListItem(view, root)
  view.focus()
  return true
}

/**
 * The ProseMirror plugin behind {@link ListZoom}. The zoomed position maps
 * through every edit and the zoom ends by itself when that item is deleted or
 * the document is replaced (a reload or a note switch).
 */
export function createListZoomPlugin(): Plugin<ListZoomState> {
  return new Plugin<ListZoomState>({
    key: listZoomKey,
    state: {
      init: () => ({ root: null }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = readZoomMeta(tr)
        if (meta !== null) {
          return meta
        }
        if (previous.root === null || !tr.docChanged) {
          return previous
        }
        const mapped = tr.mapping.mapResult(previous.root, 1)
        if (mapped.deleted || !isList(newState.doc.nodeAt(mapped.pos))) {
          return { root: null }
        }
        return mapped.pos === previous.root ? previous : { root: mapped.pos }
      },
    },
    appendTransaction: (_transactions, _oldState, newState) => {
      const root = zoomedListPos(newState)
      if (root === null) {
        return null
      }
      const bounds = zoomBounds(newState.doc, root)
      const { from, to } = newState.selection
      if (bounds === null || (from >= bounds.from && to <= bounds.to)) {
        return null
      }
      const clampedFrom = Math.min(Math.max(from, bounds.from), bounds.to)
      const clampedTo = Math.min(Math.max(to, bounds.from), bounds.to)
      return newState.tr.setSelection(
        TextSelection.between(newState.doc.resolve(clampedFrom), newState.doc.resolve(clampedTo)),
      )
    },
    props: {
      decorations: (state) => {
        const root = zoomedListPos(state)
        return root === null ? DecorationSet.empty : buildDecorations(state, root)
      },
      attributes: (state): Record<string, string> =>
        zoomedListPos(state) === null ? {} : { 'data-list-zoomed': '' },
      handleDOMEvents: {
        mousedown: handleMarkerMouseDown,
      },
    },
  })
}
