import { describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, type VaultLayout } from '../graph/vault-layout'
import { importFolders, importMappingFromLayout, type ImportMapping } from './mapping'
import { importLinkMap, planImportMoves } from './plan'
import { rewriteImportLinks } from './rewrite'

const OBSIDIAN: VaultLayout = {
  ...DEFAULT_VAULT_LAYOUT,
  dailyFolder: 'Journal/Daily',
  dailyFormat: 'DD-MM-YYYY',
  attachmentFolder: 'Resources/_attachments',
  templatesFolder: '_system/templates',
  obsidian: true,
}
const MAPPING: ImportMapping = importMappingFromLayout(OBSIDIAN)

describe('planImportMoves', () => {
  it('moves dailies, attachments and templates into Kore folders and leaves other notes', () => {
    const plan = planImportMoves(MAPPING, [
      'Journal/Daily/09-10-2026.md',
      'Journal/Daily/Invalid date.md',
      'Journal/Daily/31-02-2026.md',
      'Resources/_attachments/Shot one.png',
      'Resources/_attachments/2024/old.pdf',
      'Knowledge/Product/Pricing.md',
      'Knowledge/Product/diagram.png',
      '_system/templates/Person.md',
    ])
    expect(plan.moves).toEqual([
      { from: 'Journal/Daily/09-10-2026.md', to: 'daily/2026-10-09.md', kind: 'daily' },
      {
        from: 'Resources/_attachments/2024/old.pdf',
        to: 'assets/2024/old.pdf',
        kind: 'attachment',
      },
      {
        from: 'Resources/_attachments/Shot one.png',
        to: 'assets/Shot one.png',
        kind: 'attachment',
      },
      { from: '_system/templates/Person.md', to: 'templates/Person.md', kind: 'template' },
    ])
    expect(plan.conflicts).toEqual([])
  })

  it('moves nothing for a vault already in Kore layout', () => {
    const plan = planImportMoves(importMappingFromLayout(DEFAULT_VAULT_LAYOUT), [
      'daily/2026-10-09.md',
      'assets/a.png',
      'templates/daily.md',
      'notes/x.md',
    ])
    expect(plan).toEqual({ moves: [], conflicts: [], excluded: [] })
  })

  it('keeps a file in place when its destination is taken', () => {
    const plan = planImportMoves(MAPPING, [
      'Journal/Daily/09-10-2026.md',
      'daily/2026-10-09.md',
      'Resources/_attachments/a.png',
      'Resources/_attachments/A.PNG',
    ])
    expect(plan.moves).toEqual([
      { from: 'Resources/_attachments/A.PNG', to: 'assets/A.PNG', kind: 'attachment' },
    ])
    expect(plan.conflicts.map((conflict) => [conflict.from, conflict.reason])).toEqual([
      ['Journal/Daily/09-10-2026.md', 'occupied'],
      ['Resources/_attachments/a.png', 'duplicate'],
    ])
  })

  it('follows an edited mapping: another daily folder and format, no attachment role, exclusions', () => {
    const plan = planImportMoves(
      {
        daily: { folder: 'Diary', format: 'YYYY[_]MM[_]DD' },
        attachments: null,
        templates: '_system/templates',
        exclude: ['Archive', '_system/templates/old'],
      },
      [
        'Diary/2026_10_09.md',
        'Journal/Daily/09-10-2026.md',
        'Resources/_attachments/a.png',
        'Archive/Diary/x.md',
        'Archive/b.png',
        '_system/templates/Person.md',
        '_system/templates/old/Legacy.md',
      ],
    )
    expect(plan.moves.map((move) => [move.from, move.to])).toEqual([
      ['Diary/2026_10_09.md', 'daily/2026-10-09.md'],
      ['_system/templates/Person.md', 'templates/Person.md'],
    ])
    expect(plan.excluded).toEqual([
      'Archive/Diary/x.md',
      'Archive/b.png',
      '_system/templates/old/Legacy.md',
    ])
  })

  it('moves no dailies for an unusable format and never maps the vault root', () => {
    const plan = planImportMoves(
      { daily: { folder: '', format: 'dddd' }, attachments: '', templates: '', exclude: [] },
      ['09-10-2026.md', '2026-10-09.md', 'a.png', 'Note.md'],
    )
    expect(plan).toEqual({ moves: [], conflicts: [], excluded: [] })
  })
})

describe('rewriteImportLinks', () => {
  const map = importLinkMap(
    planImportMoves(MAPPING, [
      'Journal/Daily/09-10-2026.md',
      'Resources/_attachments/Shot one.png',
      '_system/templates/Person.md',
    ]),
  )

  it('turns links to a daily into date links, by name or by path, keeping display and fragment', () => {
    const source = [
      '---',
      'up: "[[Journal/Daily/09-10-2026]]"',
      '---',
      'See [[09-10-2026]], [[Journal/Daily/09-10-2026#Morning|that day]] and [[Other]].',
      '',
    ].join('\n')
    const result = rewriteImportLinks('Knowledge/Note.md', source, map)
    expect(result.links).toBe(3)
    expect(result.source).toBe(
      [
        '---',
        'up: "[[2026-10-09]]"',
        '---',
        'See [[2026-10-09]], [[2026-10-09#Morning|that day]] and [[Other]].',
        '',
      ].join('\n'),
    )
  })

  it('repoints attachment and template paths and leaves bare names', () => {
    const source = [
      '![[Resources/_attachments/Shot one.png|300]] ![[Shot one.png]]',
      '![shot](../Resources/_attachments/Shot%20one.png) ![x](<Resources/_attachments/Shot one.png>)',
      'Template: [[_system/templates/Person]]',
      '',
    ].join('\n')
    const result = rewriteImportLinks('Knowledge/Note.md', source, map)
    expect(result.source).toBe(
      [
        '![[assets/Shot one.png|300]] ![[Shot one.png]]',
        '![shot](assets/Shot%20one.png) ![x](<assets/Shot one.png>)',
        'Template: [[templates/Person]]',
        '',
      ].join('\n'),
    )
    expect(result.links).toBe(4)
  })

  it('never touches links inside code', () => {
    const source = '`[[09-10-2026]]`\n\n```\n[[09-10-2026]]\n```\n'
    expect(rewriteImportLinks('a.md', source, map)).toEqual({ source, links: 0 })
  })
})

describe('importFolders', () => {
  it('lists every folder holding a file, ancestors included', () => {
    expect(importFolders(['a/b/c.md', 'a/d.png', 'root.md', 'e/f/g/h.md'])).toEqual([
      'a',
      'a/b',
      'e',
      'e/f',
      'e/f/g',
    ])
  })
})
