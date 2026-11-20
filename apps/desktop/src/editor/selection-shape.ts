import { useMemo } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { AllSelection, Plugin, PluginKey, TextSelection, type Selection } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { isTouchEditorSurface } from '@/lib/platform-surface'
import '@/styles/selection.css'

/**
 * Clean, rounded, glyph-height text selection for the editor.
 *
 * WebKit (the Mac and iPhone webview) paints native `::selection` across the
 * full `line-height: 1.7` line box and fills gaps out to the editor edges.
 * - On desktop (`!isTouchEditorSurface()`), this plugin measures the exact
 *   text-node client rects of the live selection (skipping `.list-marker` and
 *   non-selectable chrome), merges adjacent inline rects on each visual line,
 *   and draws tight rounded highlight pills in a `pointer-events: none` layer
 *   *behind* `.ProseMirror`. Zero DOM nodes are mutated inside `contenteditable`,
 *   so drag-select, IME, copy/paste, and undo stay 100% native.
 * - On touch (iOS), native selection handles and loupe remain in charge, using
 *   the lightweight `kore-selection-block` identity-translate class to avoid
 *   bullet-column gap fills.
 */

export const SELECTION_BLOCK_CLASS = 'kore-selection-block'
const CUSTOM_SELECTION_ATTR = 'data-kore-custom-selection'

const selectionShapeKey = new PluginKey<DecorationSet>('kore-selection-shape')

export interface SelectionRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Whether this selection paints text highlight (a non-empty text range). */
function isTextRange(selection: Selection): boolean {
  return (
    !selection.empty && (selection instanceof TextSelection || selection instanceof AllSelection)
  )
}

/** One node decoration per textblock the selection touches; empty for a caret. */
export function selectionBlockDecorations(
  doc: ProseMirrorNode,
  selection: Selection,
): DecorationSet {
  if (!isTextRange(selection)) {
    return DecorationSet.empty
  }
  const decorations: Decoration[] = []
  for (const range of selection.ranges) {
    doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) {
        return true
      }
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: SELECTION_BLOCK_CLASS }))
      return false
    })
  }
  return DecorationSet.create(doc, decorations)
}

/**
 * Merge adjacent/overlapping client rects on the same visual line into one
 * continuous highlight bar so selections crossing inline marks (`**bold**`,
 * `[[links]]`, `#tags`) have no vertical seams.
 */
export function mergeLineRects(raw: readonly SelectionRect[]): SelectionRect[] {
  const usable = raw
    .filter((rect) => rect.width >= 0.5 && rect.height >= 0.5)
    .toSorted((left, right) => left.top - right.top || left.left - right.left)

  const merged: { left: number; top: number; right: number; bottom: number }[] = []
  for (const rect of usable) {
    const right = rect.left + rect.width
    const bottom = rect.top + rect.height
    const previous = merged.at(-1)
    if (
      previous !== undefined &&
      Math.abs(previous.top - rect.top) <= 4 &&
      Math.abs(previous.bottom - bottom) <= 6 &&
      rect.left <= previous.right + 3
    ) {
      previous.top = Math.min(previous.top, rect.top)
      previous.bottom = Math.max(previous.bottom, bottom)
      previous.right = Math.max(previous.right, right)
    } else {
      merged.push({ left: rect.left, top: rect.top, right, bottom })
    }
  }
  return merged.map((rect) => ({
    left: rect.left,
    top: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  }))
}

function isSkippedElement(element: Element | null): boolean {
  return (
    element !== null &&
    element.closest('.list-marker, [aria-hidden="true"], .kore-page-card') !== null
  )
}

/** Collect tight glyph-height rects for every selected text node inside `root`. */
function collectSelectedTextRects(root: HTMLElement, hostRect: DOMRect): SelectionRect[] {
  const selection = root.ownerDocument.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return []
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) {
    return []
  }

  const rects: SelectionRect[] = []
  const subRange = root.ownerDocument.createRange()

  const pushTextNode = (node: Text): void => {
    if (node.data.length === 0 || isSkippedElement(node.parentElement)) {
      return
    }
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.data.length
    if (end <= start) {
      return
    }
    subRange.setStart(node, start)
    subRange.setEnd(node, end)
    for (const clientRect of subRange.getClientRects()) {
      rects.push({
        left: clientRect.left - hostRect.left,
        top: clientRect.top - hostRect.top,
        width: clientRect.width,
        height: clientRect.height,
      })
    }
  }

  if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
    pushTextNode(range.commonAncestorContainer as Text)
  } else {
    const walker = root.ownerDocument.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
    )
    let current = walker.nextNode()
    while (current !== null) {
      if (range.intersectsNode(current)) {
        pushTextNode(current as Text)
      }
      current = walker.nextNode()
    }
  }

  return mergeLineRects(rects)
}

function attachSelectionOverlay(view: EditorView) {
  const host = view.dom.parentElement
  if (host === null || isTouchEditorSurface()) {
    return {}
  }
  host.classList.add('kore-selection-host')
  const overlay = view.dom.ownerDocument.createElement('div')
  overlay.className = 'kore-selection-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  host.prepend(overlay)

  let rafId = 0

  const clear = (): void => {
    if (overlay.childElementCount > 0) {
      overlay.replaceChildren()
    }
    view.dom.removeAttribute(CUSTOM_SELECTION_ATTR)
  }

  const draw = (): void => {
    rafId = 0
    if (
      view.isDestroyed ||
      !view.hasFocus() ||
      view.dom.hasAttribute('data-block-selecting') ||
      !isTextRange(view.state.selection)
    ) {
      clear()
      return
    }
    const hostRect = host.getBoundingClientRect()
    const rects = collectSelectedTextRects(view.dom, hostRect)
    if (rects.length === 0) {
      clear()
      return
    }

    const fragment = view.dom.ownerDocument.createDocumentFragment()
    for (const rect of rects) {
      const bar = view.dom.ownerDocument.createElement('div')
      bar.className = 'kore-selection-rect'
      bar.style.left = `${rect.left - 2}px`
      bar.style.top = `${rect.top - 2}px`
      bar.style.width = `${rect.width + 4}px`
      bar.style.height = `${rect.height + 4}px`
      fragment.appendChild(bar)
    }
    overlay.replaceChildren(fragment)
    view.dom.setAttribute(CUSTOM_SELECTION_ATTR, '')
  }

  const schedule = (): void => {
    if (rafId === 0) {
      rafId = requestAnimationFrame(draw)
    }
  }

  const doc = view.dom.ownerDocument
  doc.addEventListener('selectionchange', schedule)
  view.dom.addEventListener('focus', schedule)
  view.dom.addEventListener('blur', clear)
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
  resizeObserver?.observe(view.dom)

  return {
    update: () => schedule(),
    destroy: () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId)
      }
      doc.removeEventListener('selectionchange', schedule)
      view.dom.removeEventListener('focus', schedule)
      view.dom.removeEventListener('blur', clear)
      resizeObserver?.disconnect()
      view.dom.removeAttribute(CUSTOM_SELECTION_ATTR)
      overlay.remove()
    },
  }
}

export function createSelectionShapePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: selectionShapeKey,
    state: {
      init: (_config, state) => selectionBlockDecorations(state.doc, state.selection),
      apply: (tr, previous, oldState, newState) => {
        if (!tr.docChanged && !tr.selectionSet) {
          return previous
        }
        if (!isTextRange(newState.selection) && !isTextRange(oldState.selection)) {
          return previous
        }
        return selectionBlockDecorations(newState.doc, newState.selection)
      },
    },
    props: {
      decorations: (state) => selectionShapeKey.getState(state) ?? DecorationSet.empty,
    },
    view: attachSelectionOverlay,
  })
}

/** Mounts the selection shape and rounded highlight overlay inside an editor. */
export function SelectionShape(): null {
  useExtension(useMemo(() => definePlugin(createSelectionShapePlugin()), []))
  return null
}
