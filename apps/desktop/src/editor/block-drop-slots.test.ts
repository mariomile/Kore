import { markdownToDoc } from '@meowdown/core'
import { describe, expect, it } from 'vitest'
import { buildDropRows, dropSlotAt, type BlockBox } from './block-drop-slots'
import { isIdleMove } from './block-move'
import { blockRangeAt } from './block-selection-plugin'

const doc = markdownToDoc(
  ['intro', '', '- first', '  - nested one', '  - nested two', '- second', ''].join('\n'),
)

/** Every block 20px tall, stacked with no gaps, indented 24px per level. */
function layout(): { boxOf: (pos: number) => BlockBox | null; posOf: (text: string) => number } {
  const boxes = new Map<number, BlockBox>()
  const starts = new Map<string, number>()
  let line = 0
  const place = (pos: number, depth: number): void => {
    const node = doc.nodeAt(pos)
    if (node === null) return
    const top = line * 20
    const nests = node.type.name === 'list'
    // A list item is named by its own line, not by its children's.
    starts.set(nests ? (node.firstChild?.textContent ?? '') : node.textContent, pos)
    line += 1
    if (nests) {
      node.forEach((_child, offset, index) => {
        if (index > 0) place(pos + 1 + offset, depth + 1)
      })
    }
    boxes.set(pos, { top, bottom: line * 20, left: depth * 24 })
  }
  doc.forEach((_node, offset) => place(offset, 0))
  return {
    boxOf: (pos) => boxes.get(pos) ?? null,
    posOf: (text) => {
      const pos = starts.get(text)
      if (pos === undefined) throw new Error(`no block reads "${text}"`)
      return pos
    },
  }
}

describe('buildDropRows and dropSlotAt', () => {
  const { boxOf, posOf } = layout()

  it('drops above a block from its upper half and below from its lower half', () => {
    const rows = buildDropRows(doc, [], boxOf, true)
    expect(rows).toHaveLength(5)
    // "second" is the fifth line: 80..100.
    expect(dropSlotAt(rows, 200, 84)?.pos).toBe(posOf('second'))
    const end = doc.content.size
    expect(dropSlotAt(rows, 200, 96)).toEqual({ pos: end, left: 0, y: 100 })
  })

  it('offers an item’s first child place under its own line', () => {
    const rows = buildDropRows(doc, [], boxOf, true)
    // "first" owns 20..40; its lower half nests.
    expect(dropSlotAt(rows, 200, 36)).toEqual({ pos: posOf('nested one'), left: 24, y: 40 })
  })

  it('lets the finger step out of a nest by sliding left under its last item', () => {
    const rows = buildDropRows(doc, [], boxOf, true)
    const nestedTwo = posOf('nested two')
    const nestedEnd = nestedTwo + (doc.nodeAt(nestedTwo)?.nodeSize ?? 0)
    // "nested two" owns 60..80.
    expect(dropSlotAt(rows, 200, 76)?.pos).toBe(nestedEnd)
    expect(dropSlotAt(rows, 10, 76)).toEqual({ pos: posOf('second'), left: 0, y: 80 })
  })

  it('keeps a paragraph between top-level blocks', () => {
    const rows = buildDropRows(doc, [], boxOf, false)
    expect(rows).toHaveLength(3)
    // Anywhere in the lower half of the whole "first" item lands after it.
    expect(dropSlotAt(rows, 200, 70)?.pos).toBe(posOf('second'))
  })

  it('drops a dragged block where it already is while it is over its own place', () => {
    // The last nested item, lifted and barely moved: it must not leave its nest.
    const nestedTwo = blockRangeAt(doc, posOf('nested two') + 2)
    const rows = buildDropRows(doc, nestedTwo === null ? [] : [nestedTwo], boxOf, true)
    expect(rows).toHaveLength(5)
    // "nested two" owns 60..80: its own two edges, however far left the finger.
    for (const x of [200, 0]) {
      const above = dropSlotAt(rows, x, 62)
      const below = dropSlotAt(rows, x, 78)
      expect(above?.pos).toBe(nestedTwo?.from)
      expect(below?.pos).toBe(nestedTwo?.to)
      expect(isIdleMove(nestedTwo === null ? [] : [nestedTwo], above?.pos ?? -1)).toBe(true)
      expect(isIdleMove(nestedTwo === null ? [] : [nestedTwo], below?.pos ?? -1)).toBe(true)
    }
    // A dragged item takes its children's rows with it.
    const first = blockRangeAt(doc, posOf('first') + 2)
    const without = buildDropRows(doc, first === null ? [] : [first], boxOf, true)
    expect(without).toHaveLength(3)
    expect(dropSlotAt(without, 200, 50)?.pos).toBe(first?.to)
  })

  it('clamps past either end', () => {
    const rows = buildDropRows(doc, [], boxOf, true)
    expect(dropSlotAt(rows, 200, -50)?.pos).toBe(0)
    expect(dropSlotAt(rows, 200, 900)?.pos).toBe(doc.content.size)
    expect(dropSlotAt([], 0, 0)).toBeNull()
  })
})
