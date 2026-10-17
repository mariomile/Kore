import { describe, expect, it } from 'vitest'
import { buildTagTree, hasNestedTags } from './tag-tree'

describe('buildTagTree', () => {
  it('hangs each tag under its nearest present ancestor, ordered by key', () => {
    const tree = buildTagTree([
      { key: 'type/person', tag: 'type/Person', count: 4 },
      { key: 'book', tag: 'Book', count: 2 },
      { key: 'type', tag: 'type', count: 5 },
      // No `domain` row: the child still shows, from the root.
      { key: 'domain/ai', tag: 'domain/ai', count: 1 },
      // `#a/` has an empty last segment: dropped, its notes are counted by `a`.
      { key: 'a/', tag: 'a/', count: 1 },
    ])

    expect(tree.map((node) => node.key)).toEqual(['book', 'domain/ai', 'type'])
    expect(tree[2]).toEqual({
      key: 'type',
      tag: 'type',
      name: 'type',
      count: 5,
      children: [
        { key: 'type/person', tag: 'type/Person', name: 'Person', count: 4, children: [] },
      ],
    })
    expect(hasNestedTags(tree)).toBe(true)
    expect(hasNestedTags(buildTagTree([{ key: 'book', tag: 'book', count: 1 }]))).toBe(false)
  })
})
