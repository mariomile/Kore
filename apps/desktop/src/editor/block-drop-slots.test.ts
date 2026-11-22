import { markdownToDoc } from '@meowdown/core'
import { describe, expect, it } from 'vitest'
import { buildDropRows, dropSlotAt, type BlockBox } from './block-drop-slots'
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

  it('skips the dragged blocks and clamps past either end', () => {
    const dragged = blockRangeAt(doc, posOf('second') + 2)
    const rows = buildDropRows(doc, dragged === null ? [] : [dragged], boxOf, true)
    expect(rows).toHaveLength(4)
    expect(dropSlotAt(rows, 200, -50)?.pos).toBe(0)
    // Past the end, the last row left is "nested two": still nested by default.
    expect(dropSlotAt(rows, 200, 900)?.pos).toBe(posOf('second') - 1)
    expect(dropSlotAt([], 0, 0)).toBeNull()
  })
})
