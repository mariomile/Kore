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
 * Zoom into a block (Plan 33, C1): the editor shows only that block, with a
 * breadcrumb back up. A list item brings its children, a heading brings its
 * section (down to the next heading of the same or a higher level), any other
 * top-level block (paragraph, quote, callout, code, table) shows alone.
 * Everything here is decorations and selection clamping, so the document, and
 * therefore the Markdown file, is never touched by zooming.
 */

/**
 * What is zoomed: a `list` node (structural, so its children follow it), or
 * a run of top-level blocks between two document positions.
 */
export type ZoomTarget =
  | { readonly kind: 'list'; readonly root: number }
  | { readonly kind: 'range'; readonly from: number; readonly to: number }

interface BlockZoomState {
  readonly target: ZoomTarget | null
}

const blockZoomKey = new PluginKey<BlockZoomState>('kore-block-zoom')

function isList(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.name === 'list'
}

function headingLevel(node: ProseMirrorNode | null | undefined): number | null {
  if (node?.type.name !== 'heading') {
    return null
  }
  const level: unknown = node.attrs['level']
  return typeof level === 'number' ? level : null
}

function isTarget(value: unknown): value is ZoomTarget {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }
  if (value.kind === 'list') {
    return 'root' in value && typeof value.root === 'number'
  }
  return (
    value.kind === 'range' &&
    'from' in value &&
    typeof value.from === 'number' &&
    'to' in value &&
    typeof value.to === 'number'
  )
}

function readZoomMeta(tr: Transaction): { readonly target: ZoomTarget | null } | null {
  const meta: unknown = tr.getMeta(blockZoomKey)
  if (typeof meta !== 'object' || meta === null || !('target' in meta)) {
    return null
  }
  if (meta.target === null) {
    return { target: null }
  }
  return isTarget(meta.target) ? { target: meta.target } : null
}

/** What the editor is zoomed into, or null when it shows the whole note. */
export function zoomTarget(state: EditorState): ZoomTarget | null {
  return blockZoomKey.getState(state)?.target ?? null
}

function sameTarget(left: ZoomTarget | null, right: ZoomTarget | null): boolean {
  if (left === null || right === null) {
    return left === right
  }
  if (left.kind === 'list' && right.kind === 'list') {
    return left.root === right.root
  }
  return (
    left.kind === 'range' &&
    right.kind === 'range' &&
    left.from === right.from &&
    left.to === right.to
  )
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

/** Where a heading's section ends: the next heading at its level or above, else the end. */
function sectionEnd(doc: ProseMirrorNode, headingPos: number, level: number): number {
  let end = doc.content.size
  doc.forEach((child, offset) => {
    if (end !== doc.content.size || offset <= headingPos) {
      return
    }
    const childLevel = headingLevel(child)
    if (childLevel !== null && childLevel <= level) {
      end = offset
    }
  })
  return end
}

/** The zoom for the top-level block starting at `pos`: a section for a heading. */
function topLevelTarget(doc: ProseMirrorNode, pos: number): ZoomTarget | null {
  const node = doc.nodeAt(pos)
  if (node === null) {
    return null
  }
  const level = headingLevel(node)
  return {
    kind: 'range',
    from: pos,
    to: level === null ? pos + node.nodeSize : sectionEnd(doc, pos, level),
  }
}

/**
 * The headings whose sections enclose the top-level block at `pos`, outermost
 * first. The note's leading H1 is left out: it is the note itself.
 */
function enclosingHeadings(doc: ProseMirrorNode, pos: number): { pos: number; level: number }[] {
  const stack: { pos: number; level: number }[] = []
  const popTo = (level: number): void => {
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) {
      stack.pop()
    }
  }
  doc.forEach((child, offset) => {
    if (offset >= pos) {
      return
    }
    const level = headingLevel(child)
    if (level !== null) {
      popTo(level)
      stack.push({ pos: offset, level })
    }
  })
  const ownLevel = headingLevel(doc.nodeAt(pos))
  if (ownLevel !== null) {
    popTo(ownLevel)
  }
  return stack.filter((heading) => !(heading.pos === 0 && heading.level === 1))
}

/** The top-level block containing `pos` (a position inside or before it). */
function topLevelPos(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(pos)
  return $pos.depth === 0 ? pos : $pos.before(1)
}

function headingTarget(doc: ProseMirrorNode, heading: { pos: number; level: number }): ZoomTarget {
  return { kind: 'range', from: heading.pos, to: sectionEnd(doc, heading.pos, heading.level) }
}

/** One level up: the parent list item, else the enclosing section, else the whole note. */
function parentTarget(doc: ProseMirrorNode, target: ZoomTarget): ZoomTarget | null {
  if (target.kind === 'list') {
    const parent = parentListPos(doc, target.root)
    if (parent !== null) {
      return { kind: 'list', root: parent }
    }
  }
  const start = target.kind === 'list' ? topLevelPos(doc, target.root) : target.from
  const heading = enclosingHeadings(doc, start).at(-1)
  return heading === undefined ? null : headingTarget(doc, heading)
}

/** The span of the zoom, as positions around its content. */
function targetSpan(doc: ProseMirrorNode, target: ZoomTarget): { from: number; to: number } | null {
  if (target.kind === 'list') {
    const node = doc.nodeAt(target.root)
    return isList(node) ? { from: target.root, to: target.root + node.nodeSize } : null
  }
  if (target.from < 0 || target.to > doc.content.size || target.from >= target.to) {
    return null
  }
  return { from: target.from, to: target.to }
}

function setZoom(tr: Transaction, target: ZoomTarget | null): Transaction {
  tr.setMeta(blockZoomKey, { target })
  const span = target === null ? null : targetSpan(tr.doc, target)
  if (span !== null) {
    const { from, to } = tr.selection
    if (from <= span.from || to >= span.to) {
      tr.setSelection(Selection.near(tr.doc.resolve(span.from + 1)))
    }
  }
  return tr.scrollIntoView()
}

/** Zoom into `target`, or back out to the whole note with null. */
export function zoomTo(view: EditorView, target: ZoomTarget | null): void {
  if (target !== null && targetSpan(view.state.doc, target) === null) {
    return
  }
  view.dispatch(setZoom(view.state.tr, target))
}

/** The zoom the caret asks for: its innermost list item, else its top-level block. */
function targetAtCaret(state: EditorState): ZoomTarget | null {
  const { $from } = state.selection
  const listPos = enclosingListPos($from)
  if (listPos !== null) {
    return { kind: 'list', root: listPos }
  }
  return $from.depth === 0 ? null : topLevelTarget(state.doc, $from.before(1))
}

/** Zoom into the block around the caret. */
export const zoomIn: Command = (state, dispatch) => {
  const target = targetAtCaret(state)
  if (target === null || sameTarget(target, zoomTarget(state))) {
    return false
  }
  dispatch?.(setZoom(state.tr, target))
  return true
}

/** Zoom out one level: parent item, enclosing section, then the whole note. */
export const zoomOut: Command = (state, dispatch) => {
  const target = zoomTarget(state)
  if (target === null) {
    return false
  }
  dispatch?.(setZoom(state.tr, parentTarget(state.doc, target)))
  return true
}

/** The first line of the zoom: the bullet's line, or the first block's first line. */
function firstLine(state: EditorState): { start: number; end: number } | null {
  const target = zoomTarget(state)
  const span = target === null ? null : targetSpan(state.doc, target)
  if (span === null) {
    return null
  }
  const first = Selection.findFrom(state.doc.resolve(span.from), 1, true)
  if (first === null || first.from >= span.to) {
    return null
  }
  const { $from } = first
  return { start: $from.start(), end: $from.end() }
}

function onFirstLine(state: EditorState): { start: number; end: number } | null {
  const line = firstLine(state)
  const { from, to } = state.selection
  return line !== null && from >= line.start && to <= line.end ? line : null
}

/**
 * Enter at the end of a zoomed list item's own line opens a first child: the
 * sibling it would otherwise create falls outside the zoom and would vanish.
 */
const enterOnRoot: Command = (state, dispatch) => {
  const target = zoomTarget(state)
  const line = onFirstLine(state)
  if (target?.kind !== 'list' || line === null) {
    return false
  }
  if (state.selection.empty && state.selection.from === line.end && dispatch) {
    const paragraph = state.schema.nodes['paragraph']
    const child =
      paragraph === undefined
        ? undefined
        : state.schema.nodes['list']?.create(
            { kind: 'bullet', collapsed: false },
            paragraph.create(),
          )
    if (child !== undefined) {
      const insertAt = line.end + 1
      const tr = state.tr.insert(insertAt, child)
      dispatch(tr.setSelection(TextSelection.create(tr.doc, insertAt + 2)).scrollIntoView())
    }
  }
  return true
}

/** Indent, outdent and move up/down on the zoom's first line would carry it out. */
const absorbOnFirstLine: Command = (state) => onFirstLine(state) !== null

/** Backspace at the very start would join the zoom into the hidden block before it. */
const backspaceAtStart: Command = (state) => {
  const line = onFirstLine(state)
  return line !== null && state.selection.empty && state.selection.from === line.start
}

/** Forward-delete at the very end would join the next, hidden block. */
const deleteAtEnd: Command = (state) => {
  const target = zoomTarget(state)
  const span = target === null ? null : targetSpan(state.doc, target)
  if (span === null || !state.selection.empty) {
    return false
  }
  const end = Selection.findFrom(state.doc.resolve(span.to), -1, true)
  return end !== null && end.from === state.selection.from
}

/** The editor keymap the zoom installs (see `REFLECT_EDITOR_BINDINGS`). */
export const ZOOM_IN_BINDING = 'Mod-Shift-.'
export const ZOOM_OUT_BINDING = 'Mod-Shift-,'

export const blockZoomKeymap: Readonly<Record<string, Command>> = {
  [ZOOM_IN_BINDING]: zoomIn,
  [ZOOM_OUT_BINDING]: zoomOut,
  Enter: enterOnRoot,
  Tab: absorbOnFirstLine,
  'Shift-Tab': absorbOnFirstLine,
  'Alt-ArrowUp': absorbOnFirstLine,
  'Alt-ArrowDown': absorbOnFirstLine,
  Backspace: backspaceAtStart,
  Delete: deleteAtEnd,
}

function crumbLabel(node: ProseMirrorNode | null): string {
  const text = node?.textContent.trim() ?? ''
  return text === '' ? 'Untitled' : text
}

interface Crumb {
  readonly label: string
  readonly target: ZoomTarget | null
}

/** Note, enclosing headings, then enclosing list items, outermost first. */
function crumbsFor(doc: ProseMirrorNode, target: ZoomTarget): Crumb[] {
  const title = doc.firstChild
  const crumbs: Crumb[] = [
    { label: headingLevel(title) === 1 ? crumbLabel(title) : 'Note', target: null },
  ]
  const start = target.kind === 'list' ? topLevelPos(doc, target.root) : target.from
  for (const heading of enclosingHeadings(doc, start)) {
    crumbs.push({ label: crumbLabel(doc.nodeAt(heading.pos)), target: headingTarget(doc, heading) })
  }
  if (target.kind === 'list') {
    const items: number[] = []
    for (let pos = parentListPos(doc, target.root); pos !== null; pos = parentListPos(doc, pos)) {
      items.unshift(pos)
    }
    for (const pos of items) {
      crumbs.push({
        label: crumbLabel(doc.nodeAt(pos)?.firstChild ?? null),
        target: { kind: 'list', root: pos },
      })
    }
  }
  return crumbs
}

function breadcrumb(view: EditorView, target: ZoomTarget): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'kore-zoom-breadcrumb'
  nav.contentEditable = 'false'
  nav.setAttribute('aria-label', 'Zoomed block')
  for (const [index, crumb] of crumbsFor(view.state.doc, target).entries()) {
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
      zoomTo(view, crumb.target)
      view.focus()
    })
    nav.append(button)
  }
  return nav
}

function hide(from: number, node: ProseMirrorNode): Decoration {
  return Decoration.node(from, from + node.nodeSize, { class: 'kore-zoom-hidden' })
}

function listDecorations(doc: ProseMirrorNode, root: number, item: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = []
  const $root = doc.resolve(root)
  for (let depth = 0; depth <= $root.depth; depth += 1) {
    const parent = $root.node(depth)
    const keep = $root.index(depth)
    const contentStart = depth === 0 ? 0 : $root.start(depth)
    parent.forEach((child, offset, index) => {
      if (index !== keep) {
        decorations.push(hide(contentStart + offset, child))
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
    Decoration.node(root, root + item.nodeSize, { class: 'kore-zoom-root', 'data-zoom-root': '' }),
  )
  return decorations
}

function rangeDecorations(doc: ProseMirrorNode, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = []
  doc.forEach((child, offset) => {
    if (offset + child.nodeSize <= from || offset >= to) {
      decorations.push(hide(offset, child))
    }
  })
  return decorations
}

function buildDecorations(state: EditorState, target: ZoomTarget): DecorationSet {
  const { doc } = state
  const span = targetSpan(doc, target)
  if (span === null) {
    return DecorationSet.empty
  }
  const decorations =
    target.kind === 'list'
      ? listDecorations(doc, target.root, doc.nodeAt(target.root) ?? doc)
      : rangeDecorations(doc, span.from, span.to)
  decorations.push(
    Decoration.widget(span.from, (view) => breadcrumb(view, target), {
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
      key: `zoom-breadcrumb:${span.from}:${span.to}`,
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
  zoomTo(view, { kind: 'list', root })
  view.focus()
  return true
}

function mapTarget(tr: Transaction, target: ZoomTarget, doc: ProseMirrorNode): ZoomTarget | null {
  if (target.kind === 'list') {
    const mapped = tr.mapping.mapResult(target.root, 1)
    if (mapped.deleted || !isList(doc.nodeAt(mapped.pos))) {
      return null
    }
    return mapped.pos === target.root ? target : { kind: 'list', root: mapped.pos }
  }
  const from = tr.mapping.mapResult(target.from, 1)
  const to = tr.mapping.mapResult(target.to, -1)
  if (from.deleted || to.deleted || from.pos >= to.pos) {
    return null
  }
  return from.pos === target.from && to.pos === target.to
    ? target
    : { kind: 'range', from: from.pos, to: to.pos }
}

/**
 * The ProseMirror plugin behind {@link BlockZoom}. The zoom maps through every
 * edit and ends by itself when its block is deleted or the document is
 * replaced (a reload or a note switch).
 */
export function createBlockZoomPlugin(): Plugin<BlockZoomState> {
  return new Plugin<BlockZoomState>({
    key: blockZoomKey,
    state: {
      init: () => ({ target: null }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = readZoomMeta(tr)
        if (meta !== null) {
          return meta
        }
        if (previous.target === null || !tr.docChanged) {
          return previous
        }
        const target = mapTarget(tr, previous.target, newState.doc)
        return target === previous.target ? previous : { target }
      },
    },
    appendTransaction: (_transactions, _oldState, newState) => {
      const target = zoomTarget(newState)
      const span = target === null ? null : targetSpan(newState.doc, target)
      if (span === null) {
        return null
      }
      const inner = { from: span.from + 1, to: span.to - 1 }
      const { from, to } = newState.selection
      if (from >= inner.from && to <= inner.to) {
        return null
      }
      const clamp = (pos: number): number => Math.min(Math.max(pos, inner.from), inner.to)
      return newState.tr.setSelection(
        TextSelection.between(newState.doc.resolve(clamp(from)), newState.doc.resolve(clamp(to))),
      )
    },
    props: {
      decorations: (state) => {
        const target = zoomTarget(state)
        return target === null ? DecorationSet.empty : buildDecorations(state, target)
      },
      attributes: (state): Record<string, string> =>
        zoomTarget(state) === null ? {} : { 'data-block-zoomed': '' },
      handleDOMEvents: {
        mousedown: handleMarkerMouseDown,
      },
    },
  })
}
