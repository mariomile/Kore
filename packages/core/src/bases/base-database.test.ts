import { describe, expect, it } from 'vitest'
import { parseBaseFile } from './base-file'
import { baseColumnsToggled, baseDatabase, baseSortOf } from './base-database'
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

const BASE = parseBaseFile(`filters:
  and:
    - file.inFolder("Jobs")
    - status
formulas:
  role: file.basename.replace("Application ", "")
properties:
  formula.role:
    displayName: Candidatura
views:
  - type: kanban
    name: Board
    groupBy:
      property: status
      direction: ASC
    groupOrder: [to-apply, submitted, screen]
    order: [formula.role, next]
  - type: table
    name: Tabella
    order: [file.name, formula.role, status, submitted]
    filters:
      and:
        - status != "rejected"
    sort:
      - property: submitted
        direction: DESC
`)

const VAULT = createBaseVault([
  row('Jobs/Application Acme.md', {
    status: 'submitted',
    submitted: '2026-11-10',
    next: 'wait',
  }),
  row('Jobs/Application Globex.md', {
    status: 'screen',
    submitted: '2026-11-02',
  }),
  row('Jobs/Application Stark.md', {
    status: 'rejected',
    submitted: '2026-10-01',
  }),
  row('Jobs/Notes.md', {}),
])

describe('baseDatabase', () => {
  it('reads a kanban view as a board grouped in the base lane order', () => {
    const database = baseDatabase(BASE, 0, VAULT, 0)
    expect(database.view.layout).toBe('board')
    expect(database.view.group).toBe('status')
    expect(database.type.properties.find((property) => property.key === 'status')).toEqual({
      key: 'status',
      name: 'status',
      type: 'select',
      options: ['to-apply', 'submitted', 'screen', 'rejected'],
    })
    expect(database.view.columns).toEqual(['formula.role', 'next'])
    expect(database.entries[0]!.properties['formula.role']).toEqual({
      value: 'Acme',
      valueType: 'string',
      valueNumber: null,
    })
    expect(database.editableKeys.has('formula.role')).toBe(false)
    expect(database.editableKeys.has('status')).toBe(true)
  })

  it("lists a view's rows the way the base engine filters and sorts them", () => {
    const view = baseDatabase(BASE, 1, VAULT, 0).view
    expect(view.layout).toBe('table')
    expect(view.sorts).toEqual([{ key: 'submitted', direction: 'desc' }])
    expect(view.entries.map((entry) => entry.title)).toEqual([
      'Application Acme',
      'Application Globex',
    ])
    expect(view.filters.advanced).toEqual([{ kind: 'expression', source: 'status != "rejected"' }])
  })

  it('writes page sorts and column toggles back as base ids', () => {
    expect(
      baseSortOf([
        { key: '$title', direction: 'asc' },
        { key: 'formula.role', direction: 'desc' },
      ]),
    ).toEqual([
      { property: 'file.name', direction: 'asc' },
      { property: 'formula.role', direction: 'desc' },
    ])
    const table = BASE.views[1]!
    expect(baseColumnsToggled(table, 'status')).toEqual(['file.name', 'formula.role', 'submitted'])
    expect(baseColumnsToggled(table, 'next')).toEqual([
      'file.name',
      'formula.role',
      'status',
      'submitted',
      'next',
    ])
  })
})
