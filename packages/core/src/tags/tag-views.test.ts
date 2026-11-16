import { describe, expect, it } from 'vitest'
import { parseNote } from '../markdown'
import { decodeTagTypeJson, encodeTagTypeJson, parseTagTypeFrontmatter } from './tag-type'
import { parseTagViews, tagViewsToYaml } from './tag-views'

const BOARD = {
  id: 'b1',
  name: 'By status',
  view: 'board' as const,
  sorts: [{ key: 'due', direction: 'asc' as const }],
  group: 'status',
  tableGroup: null,
  match: 'any' as const,
  filters: [{ key: 'status', operator: 'is' as const, text: 'open' }],
}

describe('type views', () => {
  it('reads views from a definition note and keeps the file short', () => {
    const source = [
      '---',
      'kore: tag',
      'properties:',
      '  - { name: Status, key: status, type: select, options: [open, done] }',
      'views:',
      '  - id: t1',
      '    name: All',
      '    view: table',
      '  - id: b1',
      '    name: By status',
      '    view: board',
      '    group: status',
      '    sorts: [{ key: due, direction: asc }]',
      '    filters: [{ key: status, operator: is, text: open }]',
      '    match: any',
      '---',
      '',
    ].join('\n')
    const type = parseTagTypeFrontmatter(parseNote({ path: 'tags/task.md', source }).frontmatter)
    expect(type?.views).toEqual([
      {
        id: 't1',
        name: 'All',
        view: 'table',
        sorts: [],
        group: null,
        tableGroup: null,
        match: 'all',
        filters: [],
      },
      BOARD,
    ])
    expect(tagViewsToYaml(type?.views ?? [])[0]).toEqual({ id: 't1', name: 'All', view: 'table' })
  })

  it('drops malformed views and repeated ids', () => {
    expect(
      parseTagViews([
        { id: 'a', name: 'A', view: 'table' },
        { id: 'a', name: 'Again', view: 'grid' },
        { name: 'No id', view: 'table' },
        { id: 'c', name: 'C', view: 'spreadsheet' },
        'nope',
      ]).map((view) => view.name),
    ).toEqual(['A'])
    expect(parseTagViews('table')).toEqual([])
  })

  it('round-trips through the index column and the YAML writer', () => {
    const type = { properties: [], views: [BOARD] }
    expect(decodeTagTypeJson(encodeTagTypeJson(type))).toEqual(type)
    expect(parseTagViews(tagViewsToYaml([BOARD]))).toEqual([BOARD])
  })

  it('leaves a type without views exactly as before', () => {
    expect(encodeTagTypeJson({ properties: [] })).toBe('[]')
    expect(decodeTagTypeJson('[]')).toEqual({ properties: [] })
  })
})
