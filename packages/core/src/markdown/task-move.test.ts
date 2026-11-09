import { describe, expect, it } from 'vitest'
import { parseNote } from './extract'
import { cutTaskBlock, pasteTaskBlock, taskSectionNames } from './task-move'

function marker(source: string, text: string) {
  const task = parseNote({ path: 'n.md', source }).tasks.find((row) => row.raw.includes(text))
  if (task === undefined) {
    throw new Error(`no task ${text}`)
  }
  return { markerOffset: task.markerOffset, raw: task.raw }
}

const DAILY = [
  '## Tasks',
  '+ [ ] keep me',
  '+ [ ] !! mandare la proposta [[DeepAgent]] [[2026-11-12]] @repeat(weekly)',
  '  + [ ] scrivere i prezzi',
  '    - nota sotto',
  '+ [ ] after',
  '',
].join('\n')

describe('cutTaskBlock', () => {
  it('cuts the task with everything nested under it, dedented', () => {
    const { source, block } = cutTaskBlock(DAILY, marker(DAILY, 'mandare la proposta'))
    expect(source).toBe(['## Tasks', '+ [ ] keep me', '+ [ ] after', ''].join('\n'))
    expect(block.lines).toEqual([
      '+ [ ] !! mandare la proposta [[DeepAgent]] [[2026-11-12]] @repeat(weekly)',
      '  + [ ] scrivere i prezzi',
      '    - nota sotto',
    ])
  })

  it('re-indents a nested task to the top level', () => {
    const { block } = cutTaskBlock(DAILY, marker(DAILY, 'scrivere i prezzi'))
    expect(block.lines).toEqual(['+ [ ] scrivere i prezzi', '  - nota sotto'])
  })

  it('refuses a stale marker', () => {
    expect(() => cutTaskBlock(DAILY, { markerOffset: 3, raw: '[ ] gone' })).toThrow()
  })
})

describe('pasteTaskBlock', () => {
  const PROJECT = [
    '# DeepAgent',
    '',
    '## Pricing',
    '+ [ ] tiers',
    '',
    '## Onboarding',
    '+ [ ] mail',
    '',
  ].join('\n')
  const block = { lines: ['+ [ ] proposta', '  + [ ] prezzi'] }

  it('lands at the end of the named section', () => {
    expect(pasteTaskBlock(PROJECT, block, 'Pricing')).toBe(
      [
        '# DeepAgent',
        '',
        '## Pricing',
        '+ [ ] tiers',
        '+ [ ] proposta',
        '  + [ ] prezzi',
        '',
        '## Onboarding',
        '+ [ ] mail',
        '',
      ].join('\n'),
    )
  })

  it('lands at the end of the note, and in the last section', () => {
    const atEnd = [...PROJECT.trimEnd().split('\n'), '+ [ ] proposta', '  + [ ] prezzi', ''].join(
      '\n',
    )
    expect(pasteTaskBlock(PROJECT, block, null)).toBe(atEnd)
    expect(pasteTaskBlock(PROJECT, block, 'Onboarding')).toBe(atEnd)
  })

  it('adds a section the note lacks, and fills an empty note', () => {
    expect(pasteTaskBlock('# P\n', block, 'Later')).toBe(
      '# P\n\n## Later\n\n+ [ ] proposta\n  + [ ] prezzi\n',
    )
    expect(pasteTaskBlock('', block, null)).toBe('+ [ ] proposta\n  + [ ] prezzi\n')
  })

  it('round-trips: the pasted task parses back with its section', () => {
    const cut = cutTaskBlock(DAILY, marker(DAILY, 'mandare la proposta'))
    const pasted = parseNote({
      path: 'p.md',
      source: pasteTaskBlock(PROJECT, cut.block, 'Pricing'),
    })
    const moved = pasted.tasks.find((task) => task.raw.includes('mandare la proposta'))
    expect(moved).toMatchObject({ section: 'Pricing', dueDate: '2026-11-12' })
    const child = pasted.tasks.find((task) => task.text === 'scrivere i prezzi')
    expect(child?.breadcrumbs).toEqual([moved!.text])
  })
})

describe('taskSectionNames', () => {
  it('lists level 2+ top-level headings once, in order', () => {
    expect(taskSectionNames('# T\n## A\n> ## Quoted\n### B\n## A\n')).toEqual(['A', 'B'])
  })
})
