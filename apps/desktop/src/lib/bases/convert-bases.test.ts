import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, string>())
const readBaseFile = vi.hoisted(() =>
  vi.fn(async (path: string) => {
    const text = files.get(path)
    if (text === undefined) {
      throw new Error('missing')
    }
    return text
  }),
)
// Typing from stored values is core's (tested there); here every new column is text.
const inferConvertedFields = vi.hoisted(() =>
  vi.fn(
    async (
      _tag: string,
      columns: readonly { key: string; name: string }[],
      declared: readonly { key: string }[],
    ) =>
      columns
        .filter(
          (column, index) =>
            !declared.some((property) => property.key === column.key) &&
            columns.findIndex((other) => other.key === column.key) === index,
        )
        .map((column) => ({ name: column.name, key: column.key, type: 'text' as const })),
  ),
)
const readTagDefinition = vi.hoisted(() => vi.fn())
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  readBaseFile,
  inferConvertedFields,
}))
vi.mock('@/lib/tags/tag-type-write', () => ({ readTagDefinition, saveTagType }))

const { convertBasesToTypes } = await import('./convert-bases')

const PEOPLE = `filters:
  and:
    - file.hasTag("type/person")
views:
  - type: table
    name: All people
    order: [file.name, role]
`
const PEOPLE_BOARD = `filters: 'file.hasTag("type/person")'
views:
  - type: kanban
    name: By stage
    groupBy: { property: stage, direction: ASC }
`

beforeEach(() => {
  files.clear()
  readTagDefinition.mockReset()
  saveTagType.mockClear()
  inferConvertedFields.mockClear()
})

describe('convertBasesToTypes', () => {
  it('writes every base about one tag into that type in one save, keeping the user’s tabs', async () => {
    files.set('views/people.base', PEOPLE)
    files.set('views/people-board.base', PEOPLE_BOARD)
    files.set('views/crm.base', 'filters: \'file.inFolder("CRM")\'\n')
    const mine = {
      id: 'mine',
      name: 'Mine',
      view: 'table',
      sorts: [],
      group: null,
      tableGroup: null,
      match: 'all',
      filters: [],
    }
    readTagDefinition.mockResolvedValue({
      path: 'tags/type/person.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Role', key: 'role', type: 'text' }],
      template: null,
      icon: null,
      parents: [],
      views: [mine],
    })

    const report = await convertBasesToTypes(
      ['views/people.base', 'views/people-board.base', 'views/crm.base'],
      7,
    )

    expect(saveTagType).toHaveBeenCalledTimes(1)
    const [tag, properties, generation, extras] = saveTagType.mock.calls[0] as unknown as [
      string,
      { key: string }[],
      number,
      { views: { name: string }[] },
    ]
    expect(tag).toBe('type/person')
    expect(generation).toBe(7)
    expect(properties.map((property) => property.key)).toEqual(['role', 'stage'])
    expect(extras.views.map((view) => view.name)).toEqual(['Mine', 'All people', 'By stage'])
    expect(report.converted.map((entry) => entry.path)).toEqual([
      'views/people.base',
      'views/people-board.base',
    ])
    expect(report.skipped).toEqual([
      { path: 'views/crm.base', reason: 'it selects notes by folder or formula, not by one tag' },
    ])
  })

  it('never turns a regular note at the definition path into a type', async () => {
    files.set('views/people.base', PEOPLE)
    readTagDefinition.mockResolvedValue({
      path: 'tags/type/person.md',
      exists: true,
      needsConversion: true,
      properties: [],
      template: null,
      icon: null,
      parents: [],
    })
    const report = await convertBasesToTypes(['views/people.base'], 1)
    expect(saveTagType).not.toHaveBeenCalled()
    expect(report.skipped[0]?.reason).toContain('regular note')
  })
})
