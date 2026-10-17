import { describe, expect, it } from 'vitest'
import { parseBaseFile } from './base-file'
import { baseNewNotePrefill, baseNewNotePrefillForGroup, baseNewNoteSource } from './new-note'

describe('baseNewNotePrefill', () => {
  it('reads what every matching note must carry from the and-chain of filters', () => {
    const base = parseBaseFile(`
filters:
  and:
    - file.inFolder("Active/Projects/")
    - 'file.hasTag("type/project") && note.status == "active"'
    - or:
        - priority == 1
        - priority == 2
views:
  - type: table
    filters: '1 == done && file.mtime > now() && formula.age == 3'
`)
    const prefill = baseNewNotePrefill([base.filters, base.views[0]!.filters])

    expect(prefill).toEqual({
      folder: 'Active/Projects',
      properties: { status: 'active', done: 1 },
      tags: ['type/project'],
    })
  })

  it('adds a lane value over a filter on the same key, and nothing for the empty lane', () => {
    const prefill = baseNewNotePrefill([parseBaseFile('filters: status == "todo"').filters])

    expect(baseNewNotePrefillForGroup(prefill, 'status', 'doing').properties).toEqual({
      status: 'doing',
    })
    expect(baseNewNotePrefillForGroup(prefill, 'status', null)).toBe(prefill)
  })
})

describe('baseNewNoteSource', () => {
  it('writes the title, id, properties and tags into the new note', () => {
    const source = baseNewNoteSource('Ship it', {
      folder: null,
      properties: { status: 'active' },
      tags: ['type/project'],
    })

    expect(source).toMatch(
      /^---\nid: [0-9a-z]{26}\nstatus: active\ntags:\n {2}- type\/project\n---\n# Ship it\n$/,
    )
  })
})
