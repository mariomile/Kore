import { describe, expect, it } from 'vitest'
import type { ClientRect, CollisionDetection, DroppableContainer } from '@dnd-kit/core'
import { tabDropCollision } from '@/lib/tab-drop-collision'

/**
 * The frame's collision policy over a fixed layout: one pane card at
 * (0,40)-(400,240) with its three zones, and two tab pills in the strip
 * above it. dnd-kit hands the detection only ids and rects, so the whole
 * policy is testable without a browser.
 */

type Args = Parameters<CollisionDetection>[0]

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

const RECTS: ReadonlyArray<readonly [string, ClientRect]> = [
  ['surface:daily', rect(8, 8, 120, 28)],
  ['note:notes/beta.md', rect(140, 8, 120, 28)],
  ['zone:main:center', rect(0, 40, 400, 200)],
  ['zone:main:right', rect(300, 40, 100, 200)],
  ['zone:main:below', rect(0, 160, 400, 80)],
]

function container(id: string): DroppableContainer {
  return {
    id,
    key: id,
    disabled: false,
    data: { current: undefined },
    node: { current: null },
    rect: { current: null },
  }
}

/** Everything but the pointer is fixed: the drag itself never decides this. */
function argsAt(x: number, y: number): Args {
  return {
    active: {
      id: 'surface:daily',
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    // The dragged pill rides the pointer, which is what makes it beat a card
    // on distance alone.
    collisionRect: rect(x - 60, y - 14, 120, 28),
    droppableRects: new Map(RECTS),
    droppableContainers: RECTS.map(([id]) => container(id)),
    pointerCoordinates: { x, y },
  }
}

function idsAt(x: number, y: number): string[] {
  return tabDropCollision(argsAt(x, y)).map((hit) => String(hit.id))
}

describe('tabDropCollision', () => {
  it('gives an edge zone the corner it shares with the centre', () => {
    // Inside the card's right quarter, so inside its centre zone too.
    expect(idsAt(350, 100)).toEqual(['zone:main:right'])
  })

  it('takes the centre when the pointer is in no edge zone', () => {
    expect(idsAt(150, 100)).toEqual(['zone:main:center'])
  })

  it('falls back to the nearest pill when the pointer is over the strip', () => {
    // The strip sits above every card: no zone contains the pointer, and the
    // pill it is on has to win so a strip can still be reordered.
    expect(idsAt(200, 20)[0]).toBe('note:notes/beta.md')
  })

  it('resolves to nothing when the pointer is outside every pane and pill', () => {
    // The sidebar, a resize handle, the gutter: a drag abandoned there must
    // not be handed the nearest pane.
    expect(idsAt(600, 300)).toEqual([])
  })

  it('keeps both edge zones in play where they overlap', () => {
    // The bottom right corner belongs to `right` and `below` at once; the
    // order is dnd-kit's own centre-distance sort, and the caller takes the
    // first.
    expect(idsAt(350, 200).toSorted()).toEqual(['zone:main:below', 'zone:main:right'])
  })
})
