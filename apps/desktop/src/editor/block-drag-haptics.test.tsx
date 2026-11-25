import { markdownToDoc } from '@meowdown/core'
import { EditorState } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { haptic } from '@/lib/haptics'
import { createBlockDragHapticsPlugin } from './block-drag-haptics'

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const BLOCK_HEIGHT = 20

/**
 * A stand-in view over three paragraphs stacked 20 px apart: `posAtCoords`
 * maps a y to the paragraph drawn there, and each paragraph's DOM box sits
 * at its row, the two things the plugin reads.
 */
function fakeView(dragging: boolean): EditorView {
  const state = EditorState.create({ doc: markdownToDoc('one\n\ntwo\n\nthree\n') })
  const starts: number[] = []
  state.doc.forEach((_node, offset) => {
    starts.push(offset)
  })
  const boxes = new Map<number, HTMLElement>()
  for (const [row, start] of starts.entries()) {
    const box = document.createElement('p')
    box.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: row * BLOCK_HEIGHT, width: 200, height: BLOCK_HEIGHT })
    boxes.set(start, box)
  }
  return {
    state,
    dragging: dragging ? { slice: state.doc.slice(0, 0), move: true } : null,
    posAtCoords: ({ top }: { top: number }) => {
      const row = Math.min(starts.length - 1, Math.max(0, Math.floor(top / BLOCK_HEIGHT)))
      return { pos: (starts[row] ?? 0) + 1, inside: -1 }
    },
    nodeDOM: (pos: number) => boxes.get(pos) ?? null,
  } as unknown as EditorView
}

function handlers(): {
  dragover: (view: EditorView, y: number) => void
  drop: (view: EditorView) => void
  dragend: (view: EditorView) => void
} {
  const events = createBlockDragHapticsPlugin().props.handleDOMEvents
  if (events === undefined) throw new Error('plugin has no DOM handlers')
  return {
    dragover: (view, y) =>
      events.dragover?.(view, new DragEvent('dragover', { clientX: 10, clientY: y })),
    drop: (view) => events.drop?.(view, new DragEvent('drop')),
    dragend: (view) => events.dragend?.(view, new DragEvent('dragend')),
  }
}

beforeEach(() => {
  vi.mocked(haptic).mockClear()
})

afterEach(() => {
  vi.mocked(haptic).mockClear()
})

describe('block drag haptics', () => {
  it('snaps once per new gap and drops once on landing', () => {
    const view = fakeView(true)
    const { dragover, drop } = handlers()

    dragover(view, 5) // top half of "one": where the drag starts, no knock
    dragover(view, 7) // same gap, under the move threshold
    expect(haptic).not.toHaveBeenCalled()

    dragover(view, 15) // bottom half of "one": the gap before "two"
    dragover(view, 23) // top half of "two": the same gap
    expect(vi.mocked(haptic).mock.calls).toEqual([['snap']])

    dragover(view, 35) // bottom half of "two": a new gap
    expect(vi.mocked(haptic).mock.calls).toEqual([['snap'], ['snap']])

    drop(view)
    expect(vi.mocked(haptic).mock.calls).toEqual([['snap'], ['snap'], ['drop']])
  })

  it('starts fresh after a drag ends without landing', () => {
    const view = fakeView(true)
    const { dragover, dragend } = handlers()

    dragover(view, 5)
    dragend(view)
    dragover(view, 35) // a new drag's first gap is where it starts
    expect(haptic).not.toHaveBeenCalled()
  })

  it('stays silent for drags that come from outside the editor', () => {
    const view = fakeView(false)
    const { dragover, drop } = handlers()

    dragover(view, 5)
    dragover(view, 35)
    drop(view)
    expect(haptic).not.toHaveBeenCalled()
  })
})
