import { describe, expect, it } from 'vitest'
import { parseBaseFile } from './base-file'
import { baseFieldSet } from './base-fields'
import { createBaseVault } from './run-view'
import type { BaseNoteRow } from './values'

function row(path: string, properties: BaseNoteRow['properties']): BaseNoteRow {
  return {
    path,
    title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    mtime: 1,
    ctime: 1,
    size: 1,
    tags: [],
    properties,
    links: [],
    backlinks: [],
  }
}

describe('baseFieldSet', () => {
  it("reads each field's kind from its notes and keeps only the base's own notes", () => {
    const base = parseBaseFile(`filters: file.inFolder("Jobs")
formulas:
  days: 1
properties:
  note.next:
    displayName: Prossimo passo
`)
    const vault = createBaseVault([
      row('Jobs/A.md', {
        status: 'submitted',
        tier: 1,
        remote: true,
        submitted: '2026-11-10',
        next: 'call',
      }),
      row('Jobs/B.md', {
        status: 'submitted',
        tier: 2,
        remote: false,
        next: 'wait',
        tags: ['x'],
      }),
      row('Jobs/C.md', { status: 'screen', links: ['a', 'b'] }),
      row('Other/D.md', { status: 'other', unrelated: 'x' }),
    ])
    const set = baseFieldSet(base, vault, 0)
    expect(set.fields.map((field) => [field.id, field.label, field.type])).toEqual([
      ['file.name', 'Name', 'text'],
      ['note.links', 'links', 'multiselect'],
      ['note.next', 'Prossimo passo', 'text'],
      ['note.remote', 'remote', 'checkbox'],
      ['note.status', 'status', 'select'],
      ['note.submitted', 'submitted', 'date'],
      ['note.tier', 'tier', 'number'],
      ['formula.days', 'days', 'formula'],
      ['file.mtime', 'Modified', 'updated'],
      ['file.ctime', 'Created', 'created'],
      ['file.folder', 'Folder', 'text'],
      ['file.tags', 'Tags', 'multiselect'],
    ])
    expect(set.entries.map((entry) => entry.path)).toEqual(['Jobs/A.md', 'Jobs/B.md', 'Jobs/C.md'])
    expect(set.entries[0]!.properties['tier']).toEqual({
      value: '1',
      valueType: 'number',
      valueNumber: 1,
    })
    expect(set.type.properties.map((property) => property.key)).toEqual([
      'links',
      'next',
      'remote',
      'status',
      'submitted',
      'tier',
    ])
  })
})
