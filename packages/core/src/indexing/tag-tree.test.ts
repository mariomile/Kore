import { describe, expect, it } from 'vitest'
import { buildTagTree, hasNestedTags, splitTypesFromTags } from './tag-tree'

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

describe('splitTypesFromTags', () => {
  const tree = buildTagTree([
    { key: 'type', tag: 'type', count: 6 },
    { key: 'type/project', tag: 'type/Project', count: 4 },
    { key: 'type/person', tag: 'type/person', count: 2 },
    { key: 'domain', tag: 'domain', count: 3 },
    { key: 'domain/ai', tag: 'domain/ai', count: 3 },
    { key: 'area', tag: 'Area', count: 5 },
    { key: 'area/health', tag: 'Area/health', count: 1 },
    { key: 'book', tag: 'book', count: 2 },
  ])

  it('moves defined tags to a flat, name-sorted Types list and keeps topics in the tree', () => {
    const { types, tags } = splitTypesFromTags(tree, [
      'type/project',
      'type/person',
      'area',
      'recipe',
    ])

    expect(types).toEqual([
      { key: 'area', tag: 'Area', name: 'Area', count: 5 },
      { key: 'type/person', tag: 'type/person', name: 'person', count: 2 },
      { key: 'type/project', tag: 'type/Project', name: 'Project', count: 4 },
      // Defined, but no note is one yet.
      { key: 'recipe', tag: 'recipe', name: 'recipe', count: 0 },
    ])
    // `type` only parented types, so it goes; `area` keeps its topic child.
    expect(tags.map((node) => node.key)).toEqual(['area', 'book', 'domain'])
    expect(tags[0]?.children.map((node) => node.key)).toEqual(['area/health'])
    expect(tags[2]?.children.map((node) => node.key)).toEqual(['domain/ai'])
  })

  it('leaves the tree whole when nothing is a type', () => {
    const { types, tags } = splitTypesFromTags(tree, [])
    expect(types).toEqual([])
    expect(tags).toEqual(tree)
  })
})
