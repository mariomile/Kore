import { describe, expect, it } from 'vitest'
import { parseBaseFile } from './base-file'
import { inferFieldFromValues } from './convert-fields'
import { convertBaseToTypeViews, mergeConvertedViews } from './to-type-views'

const PERSONS = `
filters:
  and:
    - file.hasTag("type/person")
    - file.ext == "md"
formulas:
  category: if(file.hasTag("crm/founder"), "Founder", "Other")
  health_pill: html("x")
properties:
  formula.category:
    displayName: Category
  role:
    displayName: Role
  last_contact:
    displayName: Last contact
views:
  - type: table
    name: All people
    groupBy:
      property: formula.category
      direction: ASC
    order:
      - file.name
      - role
      - company
      - formula.health_pill
      - last_contact
      - tags
    sort:
      - property: company
        direction: ASC
      - property: formula.health_pill
        direction: DESC
  - type: masonry
    name: Gallery
    order: [file.name, role]
`

describe('convertBaseToTypeViews', () => {
  it('turns a one-tag base into the type views it shows, and says what stays behind', () => {
    const plan = convertBaseToTypeViews('System/views/persons.base', parseBaseFile(PERSONS))
    expect(plan.kind).toBe('converted')
    if (plan.kind !== 'converted') {
      return
    }
    expect(plan.tag).toBe('type/person')
    expect(plan.views).toEqual([
      {
        id: 'base-persons-1',
        name: 'All people',
        view: 'table',
        sorts: [{ key: 'company', direction: 'asc' }],
        group: null,
        tableGroup: null,
        match: 'all',
        filters: [],
      },
      {
        id: 'base-persons-2',
        name: 'Gallery',
        view: 'grid',
        sorts: [],
        group: null,
        tableGroup: null,
        match: 'all',
        filters: [],
      },
    ])
    expect(plan.columns).toEqual([
      { key: 'role', name: 'Role' },
      { key: 'company', name: 'company' },
      { key: 'last_contact', name: 'Last contact' },
    ])
    expect(plan.notes).toContain('"All people": grouping by formula.category not carried')
    expect(plan.notes).toContain(
      `Formula "Category" not carried: Kore can't run base formulas in a type's views`,
    )
    expect(plan.notes.some((note) => note.includes('file.ext'))).toBe(false)
  })

  it('carries simple filters and a kanban grouping', () => {
    const plan = convertBaseToTypeViews(
      'Tasks.base',
      parseBaseFile(`
filters:
  and:
    - file.tags.contains("#task")
    - file.ext == "md"
views:
  - type: kanban
    name: Board
    groupBy: { property: note.status, direction: ASC }
    filters:
      and:
        - 'kind == "work"'
        - priority > 2
        - '!due.isEmpty()'
        - owner.contains("Mario")
    limit: 50
  - type: table
    name: Either
    filters:
      or:
        - status == "open"
        - urgent
`),
    )
    if (plan.kind !== 'converted') {
      throw new Error(plan.reason)
    }
    expect(plan.tag).toBe('task')
    expect(plan.views[0]).toMatchObject({
      view: 'board',
      group: 'status',
      filters: [
        { key: 'kind', operator: 'is', text: 'work' },
        { key: 'priority', operator: 'gt', text: '2' },
        { key: 'due', operator: 'notEmpty', text: '' },
        { key: 'owner', operator: 'contains', text: 'Mario' },
      ],
    })
    expect(plan.views[1]).toMatchObject({
      match: 'any',
      filters: [
        { key: 'status', operator: 'is', text: 'open' },
        { key: 'urgent', operator: 'notEmpty', text: '' },
      ],
    })
    expect(plan.notes).toContain('"Board": the limit of 50 rows is not carried')
  })

  it('leaves folder bases, folder slices of a tag and multi-tag bases alone', () => {
    expect(
      convertBaseToTypeViews(
        'c.base',
        parseBaseFile(
          'filters:\n  and:\n    - file.hasTag("task")\n    - file.inFolder("Captoo")\n',
        ),
      ),
    ).toEqual({
      kind: 'skipped',
      reason: `it narrows #task with a rule a type's views can't hold (file.inFolder("Captoo"))`,
    })
    expect(
      convertBaseToTypeViews(
        'a.base',
        parseBaseFile('filters:\n  and:\n    - file.inFolder("CRM")\n'),
      ),
    ).toEqual({ kind: 'skipped', reason: 'it selects notes by folder or formula, not by one tag' })
    expect(
      convertBaseToTypeViews(
        'b.base',
        parseBaseFile('filters:\n  or:\n    - file.hasTag("a")\n    - file.hasTag("b")\n'),
      ).kind,
    ).toBe('skipped')
  })

  it('replaces its own earlier tabs on a second run and keeps the user’s', () => {
    const mine = {
      id: 'mine',
      name: 'Mine',
      view: 'table' as const,
      sorts: [],
      group: null,
      tableGroup: null,
      match: 'all' as const,
      filters: [],
    }
    const first = { ...mine, id: 'base-x-1', name: 'Old' }
    const again = { ...mine, id: 'base-x-1', name: 'New' }
    expect(mergeConvertedViews([mine, first], [again]).map((view) => view.name)).toEqual([
      'Mine',
      'New',
    ])
  })
})

describe('inferFieldFromValues', () => {
  const strings = (...values: string[]) => values.map((value) => ({ value, valueType: 'string' }))

  it('types a field only when every value agrees', () => {
    expect(inferFieldFromValues('due', 'Due', strings('2026-01-02', '2026-03-04')).type).toBe(
      'date',
    )
    expect(inferFieldFromValues('company', 'Company', strings('[[Acme]]', '[[Beta]]')).type).toBe(
      'relation',
    )
    expect(
      inferFieldFromValues('status', 'Status', strings('open', 'done', 'open', 'done')),
    ).toEqual({ name: 'Status', key: 'status', type: 'select', options: ['done', 'open'] })
    expect(inferFieldFromValues('role', 'Role', strings('CEO', 'CTO', 'PM')).type).toBe('text')
    expect(
      inferFieldFromValues('n', 'N', [
        { value: '1', valueType: 'number' },
        { value: 'x', valueType: 'string' },
      ]).type,
    ).toBe('text')
    expect(inferFieldFromValues('empty', 'Empty', []).type).toBe('text')
  })
})
