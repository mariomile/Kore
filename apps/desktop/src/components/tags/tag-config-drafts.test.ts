import { describe, expect, it } from 'vitest'
import {
  draftsFromSchema,
  relationTargetSelectItems,
  relationTargetTags,
  schemaFromDrafts,
} from './tag-config-drafts'

describe('relationTargetTags', () => {
  it('includes a tag that exists on notes even without a type definition', () => {
    expect(relationTargetTags([{ tag: 'topic' }], ['person'])).toEqual([
      { key: 'person', label: 'person' },
      { key: 'topic', label: 'topic' },
    ])
  })

  it('keeps a typed collection that has no notes yet', () => {
    expect(relationTargetTags([], ['skills'])).toEqual([{ key: 'skills', label: 'skills' }])
  })

  it('prefers the casing notes use and sorts by folded key', () => {
    expect(relationTargetTags([{ tag: 'Topic' }, { tag: 'Company' }], ['topic', 'skills'])).toEqual(
      [
        { key: 'company', label: 'Company' },
        { key: 'skills', label: 'skills' },
        { key: 'topic', label: 'Topic' },
      ],
    )
  })
})

describe('relationTargetSelectItems', () => {
  it("keeps the notes' preferred casing for a selected target", () => {
    expect(relationTargetSelectItems([{ key: 'topic', label: 'Topic' }], 'topic')).toEqual({
      topic: '#Topic',
    })
  })

  it('still shows a stored target whose tag is gone', () => {
    expect(relationTargetSelectItems([{ key: 'person', label: 'person' }], 'gone')).toEqual({
      person: '#person',
      gone: '#gone',
    })
  })
})

describe('starting values in drafts', () => {
  it('round-trips each kind and drops one the type no longer takes', () => {
    const schema = [
      { name: 'Met', key: 'met', type: 'date' as const, default: 'today' },
      { name: 'Count', key: 'count', type: 'number' as const, default: 3 },
      { name: 'Done', key: 'done', type: 'checkbox' as const, default: false },
    ]
    expect(schemaFromDrafts(draftsFromSchema(schema))).toEqual(schema)
    const [met] = draftsFromSchema(schema)
    expect(schemaFromDrafts([{ ...met!, type: 'number' }])).toEqual([
      { name: 'Met', key: 'met', type: 'number' },
    ])
  })
})
