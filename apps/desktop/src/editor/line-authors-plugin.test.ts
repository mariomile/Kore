import { markdownToDoc } from '@meowdown/core'
import type { LineAuthor } from '@reflect/core'
import { describe, expect, it } from 'vitest'
import { agentHue, lineAuthorDecorations, textblockLines } from './line-authors-plugin'

const BODY = [
  '# Plan',
  '',
  'Mine **bold** and [[Link]]',
  '',
  '- one',
  '  - one',
  '- agent line',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  'two line',
  'paragraph',
  '',
].join('\n')

function textOf(pos: number): string {
  return markdownToDoc(BODY).nodeAt(pos)?.textContent ?? ''
}

describe('textblockLines', () => {
  it('finds each block’s Markdown lines in order, repeated lines and table rows included', () => {
    const lines = textblockLines(markdownToDoc(BODY), BODY)
    const byText = [...lines].map(([pos, indices]) => [textOf(pos), indices])
    expect(byText).toEqual([
      ['Plan', [0]],
      ['Mine **bold** and [[Link]]', [2]],
      ['one', [4]],
      ['one', [5]],
      ['agent line', [6]],
      ['a', [8]],
      ['b', [8]],
      ['1', [10]],
      ['2', [10]],
      ['two line\nparagraph', [12, 13]],
    ])
  })
})

describe('lineAuthorDecorations', () => {
  const owner: LineAuthor = { kind: 'owner', name: 'Mario', timeMs: 1 }
  const grok: LineAuthor = { kind: 'agent', name: 'Grok', timeMs: 5 }
  const host: LineAuthor = { kind: 'host', name: 'Kore host', timeMs: 3 }

  it('marks agent and host blocks, leaves the owner’s plain, and takes a block’s newest line', () => {
    const doc = markdownToDoc(BODY)
    const authors: LineAuthor[] = BODY.split('\n').map(() => owner)
    authors[6] = grok
    authors[13] = host
    const found = lineAuthorDecorations(doc, { body: BODY, authors })
      .find()
      .sort((a, b) => a.from - b.from)
    const marked = found.map((decoration) => [
      doc.nodeAt(decoration.from)?.textContent,
      (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs,
    ])
    expect(marked).toEqual([
      [
        'agent line',
        expect.objectContaining({
          'data-line-author': 'agent',
          'data-line-author-key': 'agent:grok',
          style: `--kore-line-author-hue: ${agentHue('Grok')}`,
        }),
      ],
      ['two line\nparagraph', expect.objectContaining({ 'data-line-author': 'host' })],
    ])
  })

  it('shows nothing for lines no commit holds yet', () => {
    const doc = markdownToDoc(BODY)
    const authors: LineAuthor[] = BODY.split('\n').map(() => ({ kind: 'unsaved' }))
    expect(lineAuthorDecorations(doc, { body: BODY, authors }).find()).toEqual([])
  })
})
