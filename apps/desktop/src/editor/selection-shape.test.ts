import { markdownToDoc } from '@meowdown/core'
import { AllSelection, NodeSelection, TextSelection } from '@prosekit/pm/state'
import { describe, expect, it } from 'vitest'
import { SELECTION_BLOCK_CLASS, selectionBlockDecorations } from './selection-shape'

const doc = markdownToDoc(
  [
    '# Title',
    '',
    '- [ ] first task',
    '- [ ] second task',
    '- bullet',
    '',
    'closing paragraph',
    '',
  ].join('\n'),
)

function textblockPositions(): number[] {
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      positions.push(pos)
      return false
    }
    return true
  })
  return positions
}

function decoratedTexts(selection: Parameters<typeof selectionBlockDecorations>[1]): string[] {
  return selectionBlockDecorations(doc, selection)
    .find()
    .map((decoration) => {
      expect(
        (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
      ).toBe(SELECTION_BLOCK_CLASS)
      return doc.nodeAt(decoration.from)?.textContent ?? ''
    })
}

describe('selectionBlockDecorations', () => {
  const blocks = textblockPositions()

  it('marks nothing for a caret', () => {
    expect(decoratedTexts(TextSelection.create(doc, blocks[1]! + 3))).toEqual([])
  })

  it('marks every textblock a range touches, partial ends included', () => {
    const selection = TextSelection.create(doc, blocks[1]! + 3, blocks[3]! + 2)
    expect(decoratedTexts(selection)).toEqual(['first task', 'second task', 'bullet'])
  })

  it('marks a single block for a range inside it', () => {
    expect(decoratedTexts(TextSelection.create(doc, blocks[0]! + 1, blocks[0]! + 4))).toEqual([
      'Title',
    ])
  })

  it('marks the whole document for select all', () => {
    expect(decoratedTexts(new AllSelection(doc))).toHaveLength(blocks.length)
  })

  it('leaves a node selection to its own outline', () => {
    const listPos = doc.resolve(blocks[1]!).before(1)
    expect(decoratedTexts(NodeSelection.create(doc, listPos))).toEqual([])
  })
})
