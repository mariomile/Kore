import { describe, expect, it } from 'vitest'
import { frontmatterSchema } from '../markdown'
import {
  decodeTagTypeJson,
  encodeTagTypeJson,
  isPropertyKey,
  isTagDefinitionNote,
  parseTagTypeFrontmatter,
  propertyKeyForName,
  relationDisplay,
  relationTarget,
  relationValue,
  tagDefinitionPath,
  tagNameForDefinitionPath,
  type TagType,
} from './tag-type'

function frontmatter(raw: Record<string, unknown>) {
  return frontmatterSchema.parse(raw)
}

describe('parseTagTypeFrontmatter', () => {
  it('returns null without the lore: tag marker', () => {
    expect(parseTagTypeFrontmatter(frontmatter({}))).toBeNull()
    expect(parseTagTypeFrontmatter(frontmatter({ lore: 'other' }))).toBeNull()
    expect(parseTagTypeFrontmatter(frontmatter({ properties: [] }))).toBeNull()
  })

  it('parses a well-formed schema in order', () => {
    const parsed = parseTagTypeFrontmatter(
      frontmatter({
        lore: 'tag',
        properties: [
          { name: 'Author', key: 'author', type: 'text' },
          { name: 'Rating', key: 'rating', type: 'number' },
          { name: 'Status', key: 'status', type: 'select', options: ['to-read', 'done'] },
        ],
      }),
    )
    expect(parsed?.properties.map((property) => property.key)).toEqual([
      'author',
      'rating',
      'status',
    ])
    expect(parsed?.properties[2]?.options).toEqual(['to-read', 'done'])
  })

  it('drops malformed, duplicate, and reserved entries without failing', () => {
    const parsed = parseTagTypeFrontmatter(
      frontmatter({
        lore: 'tag',
        properties: [
          { name: 'Author', key: 'author', type: 'text' },
          'not an object',
          { name: 'No type', key: 'oops' },
          { name: 'Bad type', key: 'bad', type: 'blob' },
          { name: 'Dup', key: 'author', type: 'number' },
          { name: 'Reserved', key: 'private', type: 'checkbox' },
          { name: '', key: 'unnamed', type: 'text' },
        ],
      }),
    )
    expect(parsed?.properties.map((property) => property.key)).toEqual(['author'])
  })

  it('treats a missing or non-array properties key as an empty schema', () => {
    expect(parseTagTypeFrontmatter(frontmatter({ lore: 'tag' }))).toEqual({ properties: [] })
    expect(parseTagTypeFrontmatter(frontmatter({ lore: 'tag', properties: 'nope' }))).toEqual({
      properties: [],
    })
  })
})

describe('schema_json codec', () => {
  it('round-trips a schema', () => {
    const type: TagType = {
      properties: [
        { name: 'Author', key: 'author', type: 'text' },
        { name: 'Topics', key: 'topics', type: 'multiselect', options: ['ai'] },
      ],
    }
    expect(decodeTagTypeJson(encodeTagTypeJson(type))).toEqual(type)
  })

  it('rejects a mangled column instead of guessing', () => {
    expect(() => decodeTagTypeJson('{"nope": true}')).toThrow()
  })
})

describe('definition paths', () => {
  it('addresses plain and nested tag names', () => {
    expect(tagNameForDefinitionPath('tags/book.md')).toBe('book')
    expect(tagNameForDefinitionPath('tags/project/atlas.md')).toBe('project/atlas')
  })

  it('rejects paths outside tags/ and invalid stems', () => {
    expect(tagNameForDefinitionPath('notes/book.md')).toBeNull()
    expect(tagNameForDefinitionPath('tags/123.md')).toBeNull()
    expect(tagNameForDefinitionPath('tags/.md')).toBeNull()
    expect(tagNameForDefinitionPath('tags/has space.md')).toBeNull()
    expect(tagNameForDefinitionPath('tags/book.txt')).toBeNull()
  })

  it('builds folded definition paths from display casing', () => {
    expect(tagDefinitionPath('Book')).toBe('tags/book.md')
    expect(tagDefinitionPath('project/Atlas')).toBe('tags/project/atlas.md')
  })
})

describe('isTagDefinitionNote', () => {
  it('requires both the path and the marker', () => {
    const marked = frontmatter({ lore: 'tag' })
    expect(isTagDefinitionNote('tags/book.md', marked)).toBe(true)
    expect(isTagDefinitionNote('tags/book.md', frontmatter({}))).toBe(false)
    expect(isTagDefinitionNote('notes/book.md', marked)).toBe(false)
  })
})

describe('relation values', () => {
  it('parses a well-formed schema with a relation property', () => {
    const parsed = parseTagTypeFrontmatter(
      frontmatter({
        lore: 'tag',
        properties: [{ name: 'Series', key: 'series', type: 'relation' }],
      }),
    )
    expect(parsed?.properties[0]?.type).toBe('relation')
  })

  it('round-trips a target through the wiki-link value form', () => {
    expect(relationValue('Ursula K. Le Guin')).toBe('[[Ursula K. Le Guin]]')
    expect(relationDisplay('[[Ursula K. Le Guin]]')).toBe('Ursula K. Le Guin')
    expect(relationTarget('[[Ursula K. Le Guin]]')).toBe('Ursula K. Le Guin')
  })

  it('prefers the alias for display but keeps the target for resolution', () => {
    expect(relationDisplay('[[Charlotte MacCaw|Mum]]')).toBe('Mum')
    expect(relationTarget('[[Charlotte MacCaw|Mum]]')).toBe('Charlotte MacCaw')
  })

  it('returns null for values that are not wiki-link-shaped', () => {
    expect(relationDisplay('just a title')).toBeNull()
    expect(relationDisplay('[[broken')).toBeNull()
    expect(relationDisplay('[[a]] and [[b]]')).toBeNull()
    expect(relationTarget('just a title')).toBeNull()
  })
})

describe('property keys', () => {
  it('accepts plain identifiers and refuses reserved keys', () => {
    expect(isPropertyKey('author')).toBe(true)
    expect(isPropertyKey('read-on')).toBe(true)
    expect(isPropertyKey('private')).toBe(false)
    expect(isPropertyKey('properties')).toBe(false)
    expect(isPropertyKey('-leading')).toBe(false)
    expect(isPropertyKey('has space')).toBe(false)
    expect(isPropertyKey('')).toBe(false)
  })

  it('slugifies display names', () => {
    expect(propertyKeyForName('Read on')).toBe('read-on')
    expect(propertyKeyForName('Autore Preferito!')).toBe('autore-preferito')
    expect(propertyKeyForName('  ')).toBe('')
    expect(propertyKeyForName('Private')).toBe('') // reserved after slugging
  })
})
