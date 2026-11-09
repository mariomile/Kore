import { describe, expect, it } from 'vitest'
import { frontmatterSchema } from '../markdown'
import {
  localDateTime,
  nextNumberKeys,
  propertyStartingValue,
  startingValueKinds,
  startingValueOf,
  startingValues,
  valuesMissingFrom,
  withStoredStartingValues,
} from './starting-values'
import { parseTagTypeFrontmatter, type TagProperty, type TagType } from './tag-type'

const AT = new Date(2026, 10, 9, 8, 5)

function field(property: Omit<TagProperty, 'name'>): TagProperty {
  return { name: property.key, ...property }
}

describe('propertyStartingValue', () => {
  it('stamps today and now in local time', () => {
    expect(
      propertyStartingValue(field({ key: 'met', type: 'date', default: 'today' }), { at: AT }),
    ).toBe('2026-11-09')
    expect(
      propertyStartingValue(field({ key: 'at', type: 'text', default: 'now' }), { at: AT }),
    ).toBe('2026-11-09 08:05')
    expect(localDateTime(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02 23:59')
  })

  it('takes next-number from the index read', () => {
    const invoice = field({ key: 'number', type: 'number', default: 'next-number' })
    expect(propertyStartingValue(invoice, { nextNumbers: new Map([['number', 43]]) })).toBe(43)
    // Not read: no value rather than a guess.
    expect(propertyStartingValue(invoice)).toBeUndefined()
  })

  it('writes a fixed value as the type stores it', () => {
    const status = field({
      key: 'status',
      type: 'status',
      options: ['Inbox', 'Done'],
      default: 'Inbox',
    })
    expect(propertyStartingValue(status)).toBe('Inbox')
    expect(propertyStartingValue(field({ key: 'n', type: 'number', default: '3' }))).toBe(3)
    expect(propertyStartingValue(field({ key: 'done', type: 'checkbox', default: false }))).toBe(
      false,
    )
    expect(
      propertyStartingValue(
        field({ key: 'tags', type: 'multiselect', options: ['a'], default: 'a' }),
      ),
    ).toEqual(['a'])
    expect(propertyStartingValue(field({ key: 'due', type: 'date', default: '2026-12-01' }))).toBe(
      '2026-12-01',
    )
  })

  it('ignores a default the type cannot hold', () => {
    expect(
      propertyStartingValue(field({ key: 's', type: 'select', options: ['a'], default: 'b' })),
    ).toBeUndefined()
    expect(
      propertyStartingValue(field({ key: 'n', type: 'number', default: 'many' })),
    ).toBeUndefined()
    expect(
      propertyStartingValue(field({ key: 'd', type: 'date', default: 'friday' })),
    ).toBeUndefined()
    expect(
      propertyStartingValue(field({ key: 't', type: 'text', default: 'next-number' })),
    ).toBeUndefined()
    expect(
      propertyStartingValue(field({ key: 'f', type: 'formula', default: 'x' })),
    ).toBeUndefined()
  })
})

describe('startingValues', () => {
  const type: TagType = {
    properties: [
      field({ key: 'added', type: 'created' }),
      field({ key: 'status', type: 'select', options: ['Lead'], default: 'Lead' }),
      field({ key: 'number', type: 'number', default: 'next-number' }),
      field({ key: 'notes', type: 'text' }),
    ],
  }

  it('joins created stamps and starting values', () => {
    expect(startingValues(type, { at: AT, nextNumbers: new Map([['number', 7]]) })).toEqual({
      added: '2026-11-09',
      status: 'Lead',
      number: 7,
    })
    expect(startingValues(null)).toEqual({})
    expect(nextNumberKeys(type)).toEqual(['number'])
  })

  it('leaves a value the note already holds alone', () => {
    const source = '---\nstatus: Won\n---\n# Acme\n'
    expect(valuesMissingFrom(source, startingValues(type, { at: AT }))).toEqual({
      added: '2026-11-09',
    })
  })

  it('offers each type only the starting values it can hold', () => {
    expect(startingValueKinds('date')).toEqual(['today', 'fixed'])
    expect(startingValueKinds('number')).toEqual(['next-number', 'fixed'])
    expect(startingValueKinds('relation')).toEqual([])
  })

  it('reads default from a definition note', () => {
    const parsed = parseTagTypeFrontmatter(
      frontmatterSchema.parse({
        lore: 'tag',
        properties: [{ name: 'Met', key: 'met', type: 'date', default: 'today' }],
      }),
    )
    expect(parsed?.properties[0]?.default).toBe('today')
  })
})

describe('startingValueOf', () => {
  it('lets an option named like a keyword be a fixed value', () => {
    expect(
      startingValueOf(
        field({ key: 'when', type: 'select', options: ['today', 'later'], default: 'today' }),
      ),
    ).toEqual({ kind: 'fixed', value: 'today' })
  })

  it('stores the validated value on each property for the CLI, dropping invalid ones', () => {
    const stored = withStoredStartingValues({
      properties: [
        field({ key: 'n', type: 'number', default: '3' }),
        field({ key: 'd', type: 'date', default: 'friday' }),
        field({ key: 'added', type: 'created' }),
      ],
    })
    expect(stored.properties).toEqual([
      { name: 'n', key: 'n', type: 'number', default: '3', start: { kind: 'fixed', value: 3 } },
      { name: 'd', key: 'd', type: 'date', default: 'friday' },
      { name: 'added', key: 'added', type: 'created', start: { kind: 'today' } },
    ])
  })
})
