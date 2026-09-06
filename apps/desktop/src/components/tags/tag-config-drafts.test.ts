import { describe, expect, it } from 'vitest'
import { relationTargetTags } from './tag-config-drafts'

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
