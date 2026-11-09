import { lineBlockId } from '@reflect/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { targetSpan } from './block-zoom-target'
import { zoomTarget, zoomTo } from './block-zoom-plugin'

/**
 * Obsidian block ids in the live editor (Plan 33 C3). A followed
 * `[[Note#^id]]` lands on the line that ends with `^id` (or, for an id alone
 * on its line, on the block above it) and flashes it. The markdown is never
 * touched by this plugin.
 */

interface BlockIdState {
  readonly flash: DecorationSet
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

/** The plugin that draws the arrival flash for {@link revealBlockId}. */
export function createBlockIdPlugin(): Plugin<BlockIdState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Plugin<BlockIdState>({
    key: blockIdKey,
    state: {
      init: () => ({ flash: DecorationSet.empty }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(blockIdKey) as
          | { flash: { from: number; to: number } | null }
          | undefined
        if (meta !== undefined) {
          return { flash: flashDecorations(state, meta.flash) }
        }
        return tr.docChanged ? { flash: value.flash.map(tr.mapping, tr.doc) } : value
      },
    },
    props: {
      decorations: (state) => blockIdKey.getState(state)?.flash ?? null,
    },
    view: () => ({
      update(view, previous) {
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
      },
    }),
  })
}
