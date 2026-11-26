import { describe, expect, it } from 'vitest'
import { parseBaseFile } from './base-file'
import {
  addBaseView,
  baseViewFilterState,
  editBaseView,
  freeBaseViewName,
  moveBaseView,
  removeBaseView,
} from './base-file-edit'

const BOARD = `filters:
  and:
    - file.inFolder("Jobs")
    - status
formulas:
  role: file.basename.replace("Application ", "")
properties:
  formula.role:
    displayName: Candidatura
views:
  # The pipeline, one lane per status.
  - type: kanban
    name: Board
    groupBy:
      property: status
      direction: ASC
    groupOrder:
      - to-apply
      - submitted
      - 
    order:
      - formula.role
      - next
    columnOrders:
      note.status:
        - to-apply
  - type: table
    name: Tabella
    order:
      - formula.role
      - status
    sort:
      - property: submitted
        direction: DESC
`

describe('editBaseView', () => {
  it('changes one key and leaves every other line of the file as it was', () => {
    const next = editBaseView(BOARD, 1, { kind: 'type', type: 'cards' })
    expect(next).toBe(BOARD.replace('  - type: table', '  - type: cards'))
  })

  it('writes sorts and grouping the way Obsidian does, and reads them back', () => {
    let next = editBaseView(BOARD, 1, {
      kind: 'sort',
      sort: [{ property: 'note.status', direction: 'asc' }],
    })
    next = editBaseView(next, 1, { kind: 'group', property: 'note.tier' })
    expect(next).toContain('direction: ASC')
    const view = parseBaseFile(next).views[1]!
    expect(view.sort).toEqual([{ property: 'note.status', direction: 'asc' }])
    expect(view.groupBy).toEqual({
      property: 'note.tier',
      direction: 'asc',
      order: [],
    })
  })

  it('keeps a lane order while the grouping property stays, and drops it on a change', () => {
    expect(editBaseView(BOARD, 0, { kind: 'group', property: 'status' })).toBe(BOARD)
    const regrouped = parseBaseFile(editBaseView(BOARD, 0, { kind: 'group', property: 'tier' }))
    expect(regrouped.views[0]!.groupBy).toEqual({
      property: 'tier',
      direction: 'asc',
      order: [],
    })
  })

  it('removes a sort, a grouping or the columns when they are emptied', () => {
    const cleared = editBaseView(
      editBaseView(editBaseView(BOARD, 1, { kind: 'sort', sort: [] }), 1, {
        kind: 'columns',
        order: [],
      }),
      0,
      { kind: 'group', property: null },
    )
    const [board, table] = parseBaseFile(cleared).views
    expect(table!.sort).toEqual([])
    expect(table!.order).toEqual([])
    expect(board!.groupBy).toBeNull()
    expect(cleared).not.toContain('groupOrder')
    expect(cleared).toContain('columnOrders')
  })
})

describe('view filters', () => {
  it('round-trips the bar rules in all and any modes', () => {
    const filters = [
      { key: 'status', operator: 'is' as const, text: 'submitted' },
      { key: 'tier', operator: 'gt' as const, text: '1' },
      { key: 'next', operator: 'notEmpty' as const, text: '' },
      { key: 'Prossimo passo', operator: 'contains' as const, text: 'call' },
    ]
    for (const match of ['all', 'any'] as const) {
      const text = editBaseView(BOARD, 1, {
        kind: 'filters',
        state: { filters, match, advanced: [] },
      })
      expect(baseViewFilterState(parseBaseFile(text).views[1]!)).toEqual({
        filters,
        match,
        advanced: [],
      })
    }
  })

  it('ORs two picks of one property under "all", as the filter bar does', () => {
    const filters = [
      { key: 'status', operator: 'is' as const, text: 'screen' },
      { key: 'status', operator: 'is' as const, text: 'interview' },
      { key: 'tier', operator: 'lt' as const, text: '3' },
    ]
    const text = editBaseView(BOARD, 1, {
      kind: 'filters',
      state: { filters, match: 'all', advanced: [] },
    })
    expect(parseBaseFile(text).views[1]!.filters).toEqual({
      kind: 'and',
      items: [
        {
          kind: 'or',
          items: [
            { kind: 'expression', source: 'status == "screen"' },
            { kind: 'expression', source: 'status == "interview"' },
          ],
        },
        { kind: 'expression', source: 'tier < 3' },
      ],
    })
    expect(baseViewFilterState(parseBaseFile(text).views[1]!)).toEqual({
      filters,
      match: 'all',
      advanced: [],
    })
  })

  it('keeps the rules the bar cannot show beside the ones it edits', () => {
    const withFormula = editBaseView(BOARD, 1, {
      kind: 'filters',
      state: {
        filters: [],
        match: 'all',
        advanced: [{ kind: 'expression', source: 'formula.role != ""' }],
      },
    })
    const state = baseViewFilterState(parseBaseFile(withFormula).views[1]!)
    const anyOf = [
      { key: 'status', operator: 'is' as const, text: 'screen' },
      { key: 'tier', operator: 'gt' as const, text: '1' },
    ]
    const edited = editBaseView(withFormula, 1, {
      kind: 'filters',
      state: { ...state, filters: anyOf, match: 'any' },
    })
    expect(baseViewFilterState(parseBaseFile(edited).views[1]!)).toEqual({
      filters: anyOf,
      match: 'any',
      advanced: [{ kind: 'expression', source: 'formula.role != ""' }],
    })
  })

  it('removes the key when no rule is left', () => {
    const text = editBaseView(BOARD, 1, {
      kind: 'filters',
      state: { filters: [], match: 'all', advanced: [] },
    })
    expect(parseBaseFile(text).views[1]!.filters).toBeNull()
  })
})

describe('views', () => {
  it('adds a view from the current one, renames, moves and removes views', () => {
    const base = parseBaseFile(BOARD)
    let text = addBaseView(BOARD, {
      type: 'cards',
      name: freeBaseViewName(base.views, 'Board'),
      from: base.views[1]!,
    })
    let views = parseBaseFile(text).views
    expect(views.map((view) => [view.name, view.type])).toEqual([
      ['Board', 'kanban'],
      ['Tabella', 'table'],
      ['Board 2', 'cards'],
    ])
    expect(views[2]!.order).toEqual(['formula.role', 'status'])
    expect(views[2]!.sort).toEqual([{ property: 'submitted', direction: 'desc' }])

    text = moveBaseView(editBaseView(text, 2, { kind: 'name', name: 'Gallery' }), 2, 0)
    views = parseBaseFile(text).views
    expect(views.map((view) => view.name)).toEqual(['Gallery', 'Board', 'Tabella'])

    text = removeBaseView(text, 1)
    expect(parseBaseFile(text).views.map((view) => view.name)).toEqual(['Gallery', 'Tabella'])
    expect(text).toContain('formulas:')
  })

  it('never removes the last view, and gives a base without views its first one', () => {
    expect(() => removeBaseView('views:\n  - type: table\n    name: Only\n', 0)).toThrow()
    const text = editBaseView('filters: status\n', 0, {
      kind: 'type',
      type: 'cards',
    })
    expect(parseBaseFile(text).views.map((view) => view.type)).toEqual(['cards'])
  })
})
