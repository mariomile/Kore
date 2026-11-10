import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { crumbsFor, targetSpan, type ZoomTarget } from './block-zoom-target'

/**
 * What a zoom draws: the blocks it hides, the title and leaf hint of the
 * zoomed block, the breadcrumb back up, and the transition name on the block
 * that slides while a zoom animates. Decorations only, never the document.
 */

/** A breadcrumb click: zoom to the crumb at `index` of the current path. */
export type CrumbJump = (view: EditorView, index: number) => void

/** The View Transition name for the block shared by both zooms. */
const ZOOM_BLOCK_TRANSITION = 'view-transition-name: kore-zoom-block'

/** Each breadcrumb's width watcher, disconnected when its widget is destroyed. */
const crumbObservers = new WeakMap<Node, ResizeObserver>()

/** Crumbs that never fold: the note, and the last two levels. */
const MIN_FOLDABLE_CRUMBS = 4

function separator(): HTMLElement {
  const element = document.createElement('span')
  element.className = 'kore-zoom-separator'
  element.setAttribute('aria-hidden', 'true')
  element.textContent = '›'
  return element
}

/** Whether the crumbs need more room than one line gives them. */
function overflows(nav: HTMLElement): boolean {
  return [...nav.querySelectorAll('.kore-zoom-crumb')].some(
    (crumb) => crumb.scrollWidth > crumb.clientWidth + 1,
  )
}

function crumbButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'kore-zoom-crumb'
  button.textContent = label
  button.title = label
  // Keep the caret where it is: the click zooms, it does not move focus.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    onClick()
  })
  return button
}

function breadcrumb(view: EditorView, target: ZoomTarget, jump: CrumbJump): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'kore-zoom-breadcrumb'
  nav.contentEditable = 'false'
  nav.setAttribute('aria-label', 'Zoomed block')
  const crumbs = crumbsFor(view.state.doc, target)
  // The middle crumbs fold into "…" when the path doesn't fit on one line;
  // clicking "…" unfolds them for good.
  let expanded = false
  const render = (fold: boolean): void => {
    const hidden = fold ? crumbs.slice(1, -2) : []
    const parts: HTMLElement[] = []
    for (const [index, crumb] of crumbs.entries()) {
      if (fold && index >= 1 && index < crumbs.length - 2) {
        if (index === 1) {
          const more = crumbButton('…', () => {
            expanded = true
            render(false)
          })
          more.classList.add('kore-zoom-more')
          more.title = hidden.map(({ label }) => label).join(' › ')
          more.setAttribute('aria-label', `Show ${hidden.length} more levels`)
          parts.push(separator(), more)
        }
        continue
      }
      if (index > 0) {
        parts.push(separator())
      }
      parts.push(
        crumbButton(crumb.label, () => {
          jump(view, index)
        }),
      )
    }
    nav.replaceChildren(...parts)
  }
  const fit = (): void => {
    render(false)
    if (!expanded && crumbs.length >= MIN_FOLDABLE_CRUMBS && overflows(nav)) {
      render(true)
    }
  }
  render(false)
  // Measure once attached, and again whenever the editor's width changes.
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(fit)
    observer.observe(nav)
    crumbObservers.set(nav, observer)
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

/**
 * The block that reads as the zoomed page's title: a list item's own line,
 * or the heading a section zoom starts with. A lone paragraph has none.
 */
function titleDecoration(doc: ProseMirrorNode, target: ZoomTarget): Decoration | null {
  const pos = target.kind === 'list' ? target.root + 1 : target.from
  const node = doc.nodeAt(pos)
  if (node === null || !node.isTextblock) {
    return null
  }
  if (target.kind === 'range' && node.type.name !== 'heading') {
    return null
  }
  return Decoration.node(pos, pos + node.nodeSize, { class: 'kore-zoom-title' })
}

/** Whether a zoomed list item has nothing under its own line yet. */
export function isLeaf(doc: ProseMirrorNode, target: ZoomTarget): boolean {
  if (target.kind !== 'list') {
    return false
  }
  const item = doc.nodeAt(target.root)
  return item !== null && isListNode(item) && item.childCount <= 1
}

function isListNode(node: ProseMirrorNode): boolean {
  return node.type.name === 'list'
}

/** Under a zoomed item with no children: how to start them. */
function leafHint(): HTMLElement {
  const hint = document.createElement('div')
  hint.className = 'kore-zoom-leaf-hint'
  hint.contentEditable = 'false'
  hint.textContent = 'Press Enter at the end of the line to add a sub-item'
  return hint
}

export function buildDecorations(
  doc: ProseMirrorNode,
  target: ZoomTarget | null,
  transition: number | null,
  jump: CrumbJump,
): DecorationSet {
  const sliding = transition === null ? null : doc.nodeAt(transition)
  const slide =
    transition === null || sliding === null
      ? []
      : [
          Decoration.node(transition, transition + sliding.nodeSize, {
            style: ZOOM_BLOCK_TRANSITION,
          }),
        ]
  const span = target === null ? null : targetSpan(doc, target)
  if (target === null || span === null) {
    return slide.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, slide)
  }
  const decorations =
    target.kind === 'list'
      ? listDecorations(doc, target.root, doc.nodeAt(target.root) ?? doc)
      : rangeDecorations(doc, span.from, span.to)
  const title = titleDecoration(doc, target)
  if (title !== null) {
    decorations.push(title)
  }
  if (target.kind === 'list' && isLeaf(doc, target)) {
    decorations.push(
      Decoration.widget(span.to - 1, leafHint, {
        side: 1,
        ignoreSelection: true,
        key: 'zoom-leaf-hint',
      }),
    )
  }
  decorations.push(
    Decoration.widget(span.from, (view) => breadcrumb(view, target, jump), {
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
      destroy: (node) => {
        crumbObservers.get(node)?.disconnect()
      },
      key: 'zoom-breadcrumb',
    }),
  )
  return DecorationSet.create(doc, [...decorations, ...slide])
}
