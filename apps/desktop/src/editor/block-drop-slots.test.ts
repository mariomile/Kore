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
    // "first" is the second line: 20..40.
    expect(dropSlotAt(rows, 200, 24)?.pos).toBe(posOf('first'))
    // "second" is the fifth line: 80..100. Above it the nest has just closed,
    // so only a finger out at its own level lands right before it.
    expect(dropSlotAt(rows, 0, 84)?.pos).toBe(posOf('second'))
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

  it('keeps a dragged block where it is until the finger slides left to step out', () => {
    const nestedTwo = blockRangeAt(doc, posOf('nested two') + 2)
    const first = blockRangeAt(doc, posOf('first') + 2)
    const dragged = nestedTwo === null ? [] : [nestedTwo]
    const rows = buildDropRows(doc, dragged, boxOf, true)
    expect(rows).toHaveLength(5)
    // "nested two" owns 60..80 and "second" 80..100: the gap between them is
    // one place, whichever row's half the finger is in.
    for (const y of [78, 82]) {
      // At the item's own level it stays the last nested item.
      const nested = dropSlotAt(rows, 200, y)
      expect(nested?.pos).toBe(nestedTwo?.to)
      expect(isIdleMove(dragged, nested?.pos ?? -1)).toBe(true)
      // Slid left it steps out, after the item it was nested in.
      const out = dropSlotAt(rows, 0, y)
      expect(out?.pos).toBe(first?.to)
      expect(isIdleMove(dragged, out?.pos ?? -1)).toBe(false)
    }
    // Over its upper half it stays put.
    expect(isIdleMove(dragged, dropSlotAt(rows, 0, 62)?.pos ?? -1)).toBe(true)
    // A dragged item takes its children's rows with it.
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
