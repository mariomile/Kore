import { docToMarkdown, markdownToDoc } from '@meowdown/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { EditorState, TextSelection } from '@prosekit/pm/state'
import { describe, expect, it } from 'vitest'
import { isIdleMove, moveBlocks, moveCaretBlock, siblingMoveTarget } from './block-move'
import { blockRangeAt, type BlockRange } from './block-selection-plugin'

const NOTE = [
  '# Title',
  '',
  'opening paragraph',
  '',
  '- first',
  '  - nested one',
  '  - nested two',
  '- second',
  '',
  'closing paragraph',
  '',
].join('\n')

function stateOf(markdown: string): EditorState {
  return EditorState.create({ doc: markdownToDoc(markdown) })
}

/** The block whose own line reads `text`. */
function blockOf(doc: ProseMirrorNode, text: string): BlockRange {
  let found: BlockRange | null = null
  doc.descendants((node, pos) => {
    if (found === null && node.isTextblock && node.textContent === text) {
      found = blockRangeAt(doc, pos + 1)
    }
    return found === null
  })
  if (found === null) throw new Error(`no block reads "${text}"`)
  return found
}

function moved(state: EditorState, texts: string[], target: number): string | null {
  const blocks = texts.map((text) => blockOf(state.doc, text))
  const move = moveBlocks(state, blocks, target)
  return move === null ? null : docToMarkdown(move.tr.doc)
}

describe('moveBlocks', () => {
  it('sets a paragraph down in any gap between top-level blocks', () => {
    const state = stateOf(NOTE)
    const target = blockOf(state.doc, 'closing paragraph').to
    expect(moved(state, ['opening paragraph'], target)).toBe(
      [
        '# Title',
        '',
        '- first',
        '  - nested one',
        '  - nested two',
        '- second',
        '',
        'closing paragraph',
        '',
        'opening paragraph',
        '',
      ].join('\n'),
    )
  })

  it('takes a list item with its children, and reports where it starts', () => {
    const state = stateOf(NOTE)
    const first = blockOf(state.doc, 'first')
    const move = moveBlocks(state, [first], blockOf(state.doc, 'second').to)
    expect(move).not.toBeNull()
    const start = move?.starts[0] ?? -1
    expect(move?.tr.doc.nodeAt(start)?.textContent).toBe('firstnested onenested two')
  })

  it('nests an item dropped among another item’s children', () => {
    const state = stateOf(NOTE)
    const target = blockOf(state.doc, 'nested two').from
    expect(moved(state, ['second'], target)).toContain(
      ['- first', '  - nested one', '  - second', '  - nested two'].join('\n'),
    )
  })

  it('gathers blocks picked apart into one run, in document order', () => {
    const state = stateOf(NOTE)
    const result = moved(state, ['opening paragraph', 'closing paragraph'], 0)
    expect(result?.startsWith('opening paragraph\n\nclosing paragraph\n\n# Title')).toBe(true)
  })

  it('refuses a move that changes nothing or lands inside the moved block', () => {
    const state = stateOf(NOTE)
    const first = blockOf(state.doc, 'first')
    expect(moveBlocks(state, [first], first.from)).toBeNull()
    expect(moveBlocks(state, [first], first.to)).toBeNull()
    expect(moveBlocks(state, [first], blockOf(state.doc, 'nested one').from)).toBeNull()
    expect(isIdleMove([], 0)).toBe(true)
  })
})

describe('siblingMoveTarget', () => {
  it('steps any block over the block next to it', () => {
    const state = stateOf(NOTE)
    const opening = blockOf(state.doc, 'opening paragraph')
    const up = siblingMoveTarget(state.doc, [opening], 'up')
    const down = siblingMoveTarget(state.doc, [opening], 'down')
    expect(up).toBe(blockOf(state.doc, 'Title').from)
    // Below the whole item under it, children included.
    expect(down).toBe(blockOf(state.doc, 'first').to)
  })

  it('stops at the edges of the parent, and under the parent’s own line', () => {
    const state = stateOf(NOTE)
    expect(siblingMoveTarget(state.doc, [blockOf(state.doc, 'Title')], 'up')).toBeNull()
    expect(
      siblingMoveTarget(state.doc, [blockOf(state.doc, 'closing paragraph')], 'down'),
    ).toBeNull()
    expect(siblingMoveTarget(state.doc, [blockOf(state.doc, 'nested one')], 'up')).toBeNull()
    expect(siblingMoveTarget(state.doc, [blockOf(state.doc, 'nested two')], 'down')).toBeNull()
  })

  it('moves several blocks as one when they share a parent, and not otherwise', () => {
    const state = stateOf(NOTE)
    const pair = [blockOf(state.doc, 'first'), blockOf(state.doc, 'second')]
    expect(siblingMoveTarget(state.doc, pair, 'up')).toBe(
      blockOf(state.doc, 'opening paragraph').from,
    )
    const apart = [blockOf(state.doc, 'nested one'), blockOf(state.doc, 'second')]
    expect(siblingMoveTarget(state.doc, apart, 'down')).toBeNull()
  })
})

describe('moveCaretBlock', () => {
  it('steps the caret’s block and keeps the caret where it was in the text', () => {
    const base = stateOf(NOTE)
    const opening = blockOf(base.doc, 'opening paragraph')
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, opening.from + 4)))
    const tr = moveCaretBlock(state, 'up')
    expect(tr).not.toBeNull()
    expect(docToMarkdown(tr?.doc ?? base.doc).startsWith('opening paragraph\n\n# Title')).toBe(true)
    expect(tr?.selection.$from.parent.textContent).toBe('opening paragraph')
    expect(tr?.selection.$from.parentOffset).toBe(3)
  })

  it('has nowhere to go at the top of the note', () => {
    const base = stateOf(NOTE)
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 2)))
    expect(moveCaretBlock(state, 'up')).toBeNull()
  })
})
