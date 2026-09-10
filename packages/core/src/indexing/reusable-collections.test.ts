import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { CollectionDefinition } from '../tags'
import { listReusableCollection, resolveCollectionNoteReference } from './reusable-collections'

const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  mockInvoke.mockReset()
  setBridge({ invoke: mockInvoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

describe('reusable collections', () => {
  it('unions tagged and untagged manual rows, applies a resolved relation, and derives fields', async () => {
    mockInvoke
      .mockResolvedValueOnce([{ path: 'notes/tagged.md', title: 'Tagged', mtime: 2, is_pinned: 0 }])
      .mockResolvedValueOnce([
        {
          note_path: 'notes/tagged.md',
          key: 'project',
          value: '[[Kore]]',
          value_type: 'string',
          value_number: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ note_path: 'notes/kore.md', tier: 1 }])
      .mockResolvedValueOnce([{ path: 'notes/manual.md' }])
      .mockResolvedValueOnce([{ path: 'notes/manual.md', title: 'Manual', mtime: 3, is_pinned: 0 }])
      .mockResolvedValueOnce([
        {
          note_path: 'notes/manual.md',
          key: 'effort',
          value: '3',
          value_type: 'number',
          value_number: 3,
        },
      ])
      .mockResolvedValueOnce([{ note_path: 'notes/tagged.md', tag_key: 'project' }])
      .mockResolvedValueOnce([
        {
          tag_key: 'project',
          note_path: 'tags/project.md',
          schema_json: '[{"name":"Project","key":"project","type":"relation"}]',
        },
      ])

    const definition: CollectionDefinition = {
      id: '01COLLECTION',
      path: 'notes/active-work.md',
      title: 'Active work',
      config: {
        version: 1,
        sources: {
          tags: ['project'],
          relation: { key: 'project', target: '[[Kore]]' },
          include: ['01MANUAL'],
          exclude: [],
        },
      },
    }
    const result = await listReusableCollection(definition)

    expect(result.rows.map((row) => row.path)).toEqual(['notes/manual.md', 'notes/tagged.md'])
    expect(result.rows[0]?.properties.effort?.valueNumber).toBe(3)
    expect(result.schema.fields.map((field) => field.key)).toEqual(['project', 'effort'])
    expect(result.diagnostics).toEqual([])
  })

  it('preserves duplicate-id ambiguity instead of selecting a row', async () => {
    mockInvoke.mockResolvedValueOnce([{ path: 'notes/a.md' }, { path: 'notes/b.md' }])
    await expect(resolveCollectionNoteReference('01DUPLICATE')).resolves.toEqual({
      status: 'ambiguous',
      reference: '01DUPLICATE',
      candidates: ['notes/a.md', 'notes/b.md'],
    })
  })
})
