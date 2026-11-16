import { describe, expect, it } from 'vitest'
import { suggestTypeTag, tagUseCount } from './tag-binding'

describe('suggestTypeTag', () => {
  const uses = [
    { tag: 'type/project', count: 165 },
    { tag: 'Project', count: 2 },
    { tag: 'archive/project', count: 12 },
    { tag: 'type/person', count: 40 },
  ]

  it('points a flat type at the nested tag its notes use', () => {
    expect(suggestTypeTag('project', uses, ['project'])).toEqual({
      tag: 'type/project',
      key: 'type/project',
      count: 165,
    })
  })

  it('stays put when the type already binds to the most used tag', () => {
    expect(suggestTypeTag('type/project', uses, ['type/project'])).toBeNull()
  })

  it('skips a candidate that is already its own type', () => {
    expect(suggestTypeTag('project', uses, ['project', 'type/project'])).toEqual({
      tag: 'archive/project',
      key: 'archive/project',
      count: 12,
    })
  })

  it('suggests nothing when no other tag shares the name', () => {
    expect(suggestTypeTag('meeting', uses, [])).toBeNull()
  })

  it('counts exact tags case-insensitively', () => {
    expect(tagUseCount('project', uses)).toBe(2)
    expect(tagUseCount('type/person', uses)).toBe(40)
    expect(tagUseCount('area', uses)).toBe(0)
  })
})
