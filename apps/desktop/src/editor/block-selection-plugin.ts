import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Decoration, DecorationSet } from '@prosekit/pm/view'

/**
 * Whole-block selection on touch (Craft: swipe a block and it is selected as
 * a block, with an action bar underneath). View state only: the selection is
 * a set of anchors (a text position inside each block) mapped through every
 * transaction, drawn as a node decoration, and never written to Markdown.
 */

export interface BlockRange {
  from: number
  to: number
  node: ProseMirrorNode
}

interface BlockSelectionPluginState {
  anchors: readonly number[]
  /**
   * A finger is held on a block, heading for a long-press. The editor is
   * read-only for that moment, so iOS's own hold gesture (caret, word
   * selection, keyboard) has no editable text to act on.
   */
  guard: boolean
}

type BlockSelectionMeta =
  | { type: 'toggle'; anchor: number }
  | { type: 'add'; anchor: number }
  | { type: 'set'; anchors: readonly number[] }
  | { type: 'clear' }
  | { type: 'guard'; on: boolean }

export const blockSelectionKey = new PluginKey<BlockSelectionPluginState>('kore-block-selection')

const EMPTY: BlockSelectionPluginState = { anchors: [], guard: false }

/** A list item: the one block kind that holds other blocks. */
export function isListNode(node: ProseMirrorNode): boolean {
  return node.type.name === 'list'
}

/**
 * The block a position belongs to: the innermost list item around it (a
 * bullet with its children), else the top-level block.
 */
export function blockRangeAt(doc: ProseMirrorNode, position: number): BlockRange | null {
  const bounded = Math.min(Math.max(position, 0), doc.content.size)
  const $pos = doc.resolve(bounded)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (isListNode(node)) {
      return { from: $pos.before(depth), to: $pos.after(depth), node }
    }
  }
  if ($pos.depth >= 1) {
    return { from: $pos.before(1), to: $pos.after(1), node: $pos.node(1) }
  }
  const child = doc.childAfter(bounded)
  if (child.node === null) return null
  return { from: child.offset, to: child.offset + child.node.nodeSize, node: child.node }
}

/** First text position inside a block: the anchor that survives edits around it. */
function anchorFor(doc: ProseMirrorNode, range: BlockRange): number {
  const found = Selection.findFrom(doc.resolve(Math.min(range.from + 1, doc.content.size)), 1, true)
  return found === null ? range.from + 1 : found.from
}

function normalize(doc: ProseMirrorNode, anchors: readonly number[]): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const anchor of anchors) {
    const range = blockRangeAt(doc, anchor)
    if (range === null || seen.has(range.from)) continue
    seen.add(range.from)
    result.push(anchorFor(doc, range))
  }
  return result
}

/** Selected block ranges in document order, nested ones dropped under their parent. */
export function selectedBlocks(state: EditorState): BlockRange[] {
  const anchors = blockSelectionKey.getState(state)?.anchors ?? []
  const ranges = anchors
    .map((anchor) => blockRangeAt(state.doc, anchor))
    .filter((range): range is BlockRange => range !== null)
    .sort((left, right) => left.from - right.from)
  const outer: BlockRange[] = []
  for (const range of ranges) {
    const last = outer[outer.length - 1]
    if (last !== undefined && range.from < last.to) continue
    outer.push(range)
  }
  return outer
}

export function setBlockPressGuard(tr: Transaction, on: boolean): Transaction {
  return tr.setMeta(blockSelectionKey, { type: 'guard', on } satisfies BlockSelectionMeta)
}

export function hasBlockSelection(state: EditorState): boolean {
  return (blockSelectionKey.getState(state)?.anchors.length ?? 0) > 0
}

export function withBlockSelection(tr: Transaction, meta: BlockSelectionMeta): Transaction {
  return tr.setMeta(blockSelectionKey, meta)
}

export function createBlockSelectionPlugin(options: {
  onChange: (state: EditorState) => void
}): Plugin<BlockSelectionPluginState> {
  return new Plugin<BlockSelectionPluginState>({
    key: blockSelectionKey,
    state: {
      init: () => EMPTY,
      apply(tr, value, _old, next) {
        const meta = tr.getMeta(blockSelectionKey) as BlockSelectionMeta | undefined
        let anchors = value.anchors
        let guard = value.guard
        if (tr.docChanged && anchors.length > 0) {
          anchors = anchors.map((anchor) => tr.mapping.map(anchor))
        }
        if (meta !== undefined) {
          switch (meta.type) {
            case 'clear':
              anchors = []
              break
            case 'guard':
              guard = meta.on
              break
            case 'set':
              anchors = meta.anchors
              break
            case 'add':
              anchors = [...anchors, meta.anchor]
              break
            case 'toggle': {
              const range = blockRangeAt(next.doc, meta.anchor)
              const without = anchors.filter(
                (anchor) => blockRangeAt(next.doc, anchor)?.from !== range?.from,
              )
              anchors = without.length === anchors.length ? [...anchors, meta.anchor] : without
              break
            }
          }
        }
        if (anchors === value.anchors && guard === value.guard) return value
        if (anchors.length === 0) return guard ? { anchors: [], guard } : EMPTY
        return {
          anchors: anchors === value.anchors ? anchors : normalize(next.doc, anchors),
          guard,
        }
      },
    },
    props: {
      decorations(state) {
        const blocks = selectedBlocks(state)
        if (blocks.length === 0) return null
        const decorations = blocks.map((block) =>
          Decoration.node(block.from, block.to, { class: 'kore-block-selected' }),
        )
        return DecorationSet.create(state.doc, decorations)
      },
      // While blocks are selected (and while a long-press is pending) the
      // text is not editable: a tap toggles blocks, and nothing can raise
      // the keyboard or start a native text selection under the finger.
      editable(state) {
        const value = blockSelectionKey.getState(state)
        return value === undefined || (value.anchors.length === 0 && !value.guard)
      },
      attributes(state): Record<string, string> {
        return hasBlockSelection(state) ? { 'data-block-selecting': '' } : {}
      },
    },
    view() {
      let last: readonly number[] = []
      return {
        update(view) {
          const anchors = blockSelectionKey.getState(view.state)?.anchors ?? []
          if (anchors === last) return
          last = anchors
          options.onChange(view.state)
        },
      }
    },
  })
}
