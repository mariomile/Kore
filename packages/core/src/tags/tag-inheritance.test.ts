import { describe, expect, it } from 'vitest'
import {
  resolveTagTypes,
  tagDescendants,
  tagLoopThrough,
  wouldCreateTagLoop,
} from './tag-inheritance'
import type { TagProperty, TagType } from './tag-type'

function text(key: string, name = key): TagProperty {
  return { name, key, type: 'text' }
}

function types(entries: Record<string, TagType>): Map<string, TagType> {
  return new Map(Object.entries(entries))
}

function keys(type: TagType | undefined): string[] {
  return type?.properties.map((property) => property.key) ?? []
}

describe('resolveTagTypes', () => {
  it('puts inherited fields first, then the tag’s own', () => {
    const resolved = resolveTagTypes(
      types({
        contact: { properties: [text('email'), text('company')] },
        client: { properties: [text('contract')], extends: ['contact'] },
      }),
    )
    expect(keys(resolved.get('client'))).toEqual(['email', 'company', 'contract'])
    expect(keys(resolved.get('contact'))).toEqual(['email', 'company'])
  })

  it('walks a chain of parents', () => {
    const resolved = resolveTagTypes(
      types({
        contact: { properties: [text('email')] },
        person: { properties: [text('birthday')], extends: ['contact'] },
        investor: { properties: [text('fund')], extends: ['person'] },
      }),
    )
    expect(keys(resolved.get('investor'))).toEqual(['email', 'birthday', 'fund'])
  })

  it('lets the child’s field win a key clash, in the parent’s slot', () => {
    const resolved = resolveTagTypes(
      types({
        contact: { properties: [text('email'), text('status', 'Status')] },
        client: { properties: [text('contract'), text('status', 'Stage')], extends: ['contact'] },
      }),
    )
    const client = resolved.get('client')
    expect(keys(client)).toEqual(['email', 'status', 'contract'])
    expect(client?.properties[1]?.name).toBe('Stage')
  })

  it('takes the first listed parent on a clash between parents', () => {
    const resolved = resolveTagTypes(
      types({
        a: { properties: [text('x', 'From A')] },
        b: { properties: [text('x', 'From B'), text('y')] },
        c: { properties: [], extends: ['a', 'b'] },
      }),
    )
    const c = resolved.get('c')
    expect(keys(c)).toEqual(['x', 'y'])
    expect(c?.properties[0]?.name).toBe('From A')
  })

  it('ignores a parent with no definition', () => {
    const resolved = resolveTagTypes(
      types({ client: { properties: [text('contract')], extends: ['ghost'] } }),
    )
    expect(keys(resolved.get('client'))).toEqual(['contract'])
  })

  it('cuts loops instead of hanging, self-loops included', () => {
    const resolved = resolveTagTypes(
      types({
        a: { properties: [text('a')], extends: ['b'] },
        b: { properties: [text('b')], extends: ['a'] },
        self: { properties: [text('s')], extends: ['self'] },
      }),
    )
    expect(keys(resolved.get('a'))).toEqual(['b', 'a'])
    expect(keys(resolved.get('b'))).toEqual(['a', 'b'])
    expect(keys(resolved.get('self'))).toEqual(['s'])
  })

  it('leaves the stored types untouched', () => {
    const client: TagType = { properties: [text('contract')], extends: ['contact'] }
    resolveTagTypes(types({ contact: { properties: [text('email')] }, client }))
    expect(keys(client)).toEqual(['contract'])
  })
})

describe('tagDescendants', () => {
  const graph = types({
    contact: { properties: [] },
    person: { properties: [], extends: ['contact'] },
    client: { properties: [], extends: ['contact'] },
    investor: { properties: [], extends: ['person'] },
    book: { properties: [] },
  })

  it('lists direct and indirect children, sorted', () => {
    expect(tagDescendants(graph, 'contact')).toEqual(['client', 'investor', 'person'])
    expect(tagDescendants(graph, 'person')).toEqual(['investor'])
    expect(tagDescendants(graph, 'book')).toEqual([])
  })

  it('survives a loop', () => {
    const looped = types({
      a: { properties: [], extends: ['b'] },
      b: { properties: [], extends: ['a'] },
    })
    expect(tagDescendants(looped, 'a')).toEqual(['b'])
  })
})

describe('wouldCreateTagLoop', () => {
  const graph = types({
    contact: { properties: [] },
    person: { properties: [], extends: ['contact'] },
  })

  it('refuses a parent that already builds on the tag', () => {
    expect(wouldCreateTagLoop(graph, 'contact', ['person'])).toBe(true)
    expect(tagLoopThrough(graph, 'contact', ['book', 'person'])).toBe('person')
  })

  it('refuses the tag itself', () => {
    expect(wouldCreateTagLoop(graph, 'contact', ['contact'])).toBe(true)
  })

  it('allows an ordinary parent', () => {
    expect(wouldCreateTagLoop(graph, 'person', ['contact'])).toBe(false)
  })
})
