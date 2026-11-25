import { definePlugin } from '@prosekit/core'
import { Plugin, PluginKey } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'
import { useExtension } from '@meowdown/react'
import { useMemo } from 'react'
import { haptic } from '@/lib/haptics'
import { blockRangeAt } from './block-selection-plugin'

/**
 * A block dragged by its gutter grip knocks the trackpad each time the
 * landing place moves to another gap between blocks, and once more when it
 * lands: the same snap-into-place feel as a sidebar row or a tab. Pointer
 * surfaces only; the iPhone's own block drag (`block-drag.ts`) ticks from
 * its slot geometry instead.
 *
 * Only an in-editor drag counts (`view.dragging` is set): files or text
 * dragged in from outside stay silent.
 */
export function BlockDragHaptics(): null {
  const extension = useMemo(() => definePlugin(createBlockDragHapticsPlugin()), [])
  useExtension(extension)
  return null
}

const blockDragHapticsKey = new PluginKey('kore-block-drag-haptics')

/** Recompute the landing gap only after the pointer moved this far. */
const MOVE_EPSILON_PX = 4

/**
 * The gap a pointer at `clientY` points into: the position before the block
 * under it when the pointer is on its top half, after it on the bottom half.
 * Two neighbours share a gap, so the before of one equals the after of the
 * other and moving across that line is not a new place.
 */
export function dropGapAt(view: EditorView, clientX: number, clientY: number): number | null {
  const found = view.posAtCoords({ left: clientX, top: clientY })
  if (found === null) return null
  const range = blockRangeAt(view.state.doc, found.pos)
  if (range === null) return null
  const dom = view.nodeDOM(range.from)
  if (!(dom instanceof HTMLElement)) return range.from
  const box = dom.getBoundingClientRect()
  return clientY < box.top + box.height / 2 ? range.from : range.to
}

export function createBlockDragHapticsPlugin(): Plugin {
  let gap: number | null = null
  let lastY: number | null = null
  const reset = (): void => {
    gap = null
    lastY = null
  }
  return new Plugin({
    key: blockDragHapticsKey,
    props: {
      handleDOMEvents: {
        dragover(view, event) {
          if (view.dragging === null) return false
          if (lastY !== null && Math.abs(event.clientY - lastY) < MOVE_EPSILON_PX) return false
          lastY = event.clientY
          const next = dropGapAt(view, event.clientX, event.clientY)
          if (next === null) return false
          // The first gap is where the block already sits: not a move.
          if (gap !== null && next !== gap) haptic('snap')
          gap = next
          return false
        },
        drop(view) {
          if (view.dragging !== null) haptic('drop')
          reset()
          return false
        },
        dragend() {
          reset()
          return false
        },
      },
    },
  })
}
