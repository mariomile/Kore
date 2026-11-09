import type { Node as ProseMirrorNode, ResolvedPos } from '@prosekit/pm/model'
import type { Mappable } from '@prosekit/pm/transform'

/**
 * The zoom's document model (Plan 33, C1): which blocks a zoom shows, its
 * parent, and its breadcrumb, as pure functions of the document. The plugin
 * in `block-zoom-plugin.ts` turns these into decorations and commands.
 */

/**
 * What is zoomed: a `list` node (structural, so its children follow it), or
 * a run of top-level blocks between two document positions.
 */
export type ZoomTarget =
  | { readonly kind: 'list'; readonly root: number }
  | { readonly kind: 'range'; readonly from: number; readonly to: number }

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

export function sameTarget(left: ZoomTarget | null, right: ZoomTarget | null): boolean {
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
export function sectionEnd(doc: ProseMirrorNode, headingPos: number, level: number): number {
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
export function enclosingHeadings(
  doc: ProseMirrorNode,
  pos: number,
): { pos: number; level: number }[] {
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
export function parentTarget(doc: ProseMirrorNode, target: ZoomTarget): ZoomTarget | null {
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
export function targetSpan(
  doc: ProseMirrorNode,
  target: ZoomTarget,
): { from: number; to: number } | null {
  if (target.kind === 'list') {
    const node = doc.nodeAt(target.root)
    return isList(node) ? { from: target.root, to: target.root + node.nodeSize } : null
  }
  if (target.from < 0 || target.to > doc.content.size || target.from >= target.to) {
    return null
  }
  return { from: target.from, to: target.to }
}

/** The zoom the caret asks for: its innermost list item, else its top-level block. */
export function targetAt(doc: ProseMirrorNode, $from: ResolvedPos): ZoomTarget | null {
  const listPos = enclosingListPos($from)
  if (listPos !== null) {
    return { kind: 'list', root: listPos }
  }
  return $from.depth === 0 ? null : topLevelTarget(doc, $from.before(1))
}

function crumbLabel(node: ProseMirrorNode | null): string {
  const text = node?.textContent.trim() ?? ''
  return text === '' ? 'Untitled' : text
}

export interface Crumb {
  readonly label: string
  readonly target: ZoomTarget | null
}

/** Note, enclosing headings, then enclosing list items, outermost first. */
export function crumbsFor(doc: ProseMirrorNode, target: ZoomTarget): Crumb[] {
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

/** The zoom after an edit, or null when its block is gone. */
export function mapTarget(
  mapping: Mappable,
  target: ZoomTarget,
  doc: ProseMirrorNode,
): ZoomTarget | null {
  if (target.kind === 'list') {
    const mapped = mapping.mapResult(target.root, 1)
    if (mapped.deleted || !isList(doc.nodeAt(mapped.pos))) {
      return null
    }
    return mapped.pos === target.root ? target : { kind: 'list', root: mapped.pos }
  }
  const from = mapping.mapResult(target.from, 1)
  const to = mapping.mapResult(target.to, 1)
  if (from.deleted || to.deleted || from.pos >= to.pos) {
    return null
  }
  return from.pos === target.from && to.pos === target.to
    ? target
    : { kind: 'range', from: from.pos, to: to.pos }
}
