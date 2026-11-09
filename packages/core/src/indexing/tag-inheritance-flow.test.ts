import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { setBridge } from '../ipc/bridge'
import {
  applyProjection,
  applyTagTypeRow,
  connectIndex,
  openMigratedIndex,
  project,
} from './flow-test-harness'
import { getTagType, listCollection, listNoteTagTypes, listTagTypes } from './collections'
import {
  listTagChildren,
  listTagParentCandidates,
  refreshTagTypeResolutions,
  tagExtendsLoop,
} from './resolved-tag-types'

/**
 * Tags that build on other tags (Plan 33 B2) against a real SQLite index from
 * the production migrations: the inheritance pass stores its results in
 * `tag_types`, and every read below sees only those columns.
 */
let database: DatabaseSync

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
})

afterEach(() => {
  setBridge(null)
  database.close()
})

function addNote(path: string, source: string, mtime = 1000): void {
  const indexed = project(path, source, mtime)
  applyProjection(database, indexed)
  applyTagTypeRow(database, indexed)
}

function definition(fields: string[], options: { extends?: string; private?: boolean } = {}) {
  const lines = ['---', 'lore: tag']
  if (options.extends !== undefined) {
    lines.push(`extends: ${options.extends}`)
  }
  if (options.private === true) {
    lines.push('private: true')
  }
  lines.push('properties:')
  for (const field of fields) {
    lines.push(`  - {name: ${field}, key: ${field}, type: text}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

function keys(type: { properties: { key: string }[] } | null | undefined): string[] {
  return type?.properties.map((property) => property.key) ?? []
}

function crm(): void {
  addNote('tags/contact.md', definition(['email', 'company']))
  addNote('tags/client.md', definition(['contract'], { extends: 'contact' }))
  addNote('people/ada.md', '# Ada\n\n#contact')
  addNote('people/acme.md', '# Acme\n\n#client')
  addNote('people/vip.md', '# Vip\n\n#client/vip')
}

describe('tag inheritance through the index', () => {
  it('stores the effective schema, parents first', async () => {
    crm()
    await refreshTagTypeResolutions(1)
    expect(keys(await getTagType('Client'))).toEqual(['email', 'company', 'contract'])
    expect(keys(await getTagType('contact'))).toEqual(['email', 'company'])
    const [entry] = await listNoteTagTypes('people/acme.md')
    expect(keys(entry?.type)).toEqual(['email', 'company', 'contract'])
  })

  it('falls back to the own schema before the first pass', async () => {
    crm()
    expect(keys(await getTagType('client'))).toEqual(['contract'])
    expect(await listTagChildren('contact')).toEqual([])
  })

  it('lists the notes of child tags, nested ones included, unless ownOnly', async () => {
    crm()
    await refreshTagTypeResolutions(1)
    const all = await listCollection('contact')
    expect(all.map((entry) => entry.path).sort()).toEqual([
      'people/acme.md',
      'people/ada.md',
      'people/vip.md',
    ])
    const own = await listCollection('contact', [], { ownOnly: true })
    expect(own.map((entry) => entry.path)).toEqual(['people/ada.md'])
    expect(await listTagChildren('contact')).toEqual(['client'])
  })

  it('cuts a hand-written loop instead of hanging', async () => {
    addNote('tags/a.md', definition(['a'], { extends: 'b' }))
    addNote('tags/b.md', definition(['b'], { extends: 'a' }))
    await refreshTagTypeResolutions(1)
    expect(keys(await getTagType('a'))).toEqual(['b', 'a'])
    expect(keys(await getTagType('b'))).toEqual(['a', 'b'])
  })

  it('refuses a save that would close a loop and leaves it out of the picker', async () => {
    addNote('tags/book.md', definition(['author']))
    crm()
    await refreshTagTypeResolutions(1)
    expect(await tagExtendsLoop('Contact', ['client'])).toBe('client')
    expect(await tagExtendsLoop('contact', ['contact'])).toBe('contact')
    expect(await tagExtendsLoop('client', ['contact'])).toBeNull()
    expect(await listTagParentCandidates('contact')).toEqual(['book'])
    expect(await listTagParentCandidates('client')).toEqual(['book', 'contact'])
  })
})

describe('private definitions on outbound reads', () => {
  function privateParent(): void {
    addNote('tags/contact.md', definition(['phone'], { private: true }))
    addNote('tags/client.md', definition(['contract'], { extends: 'contact' }))
    addNote('tags/lead.md', definition(['source'], { extends: 'contact' }))
    addNote('tags/secret.md', definition(['codename'], { extends: 'client', private: true }))
    addNote('people/acme.md', '# Acme\n\n#client')
    addNote('people/x.md', '# X\n\n#secret')
  }

  it('keeps a private parent’s fields out of a public child', async () => {
    privateParent()
    await refreshTagTypeResolutions(1)
    // Local surfaces see the whole schema.
    expect(keys(await getTagType('client'))).toEqual(['phone', 'contract'])
    // Outbound ones see neither the private parent nor its fields.
    expect(keys(await getTagType('client', { excludePrivate: true }))).toEqual(['contract'])
    expect(await getTagType('contact', { excludePrivate: true })).toBeNull()
    const listed = await listTagTypes({ excludePrivate: true })
    expect(listed.map((entry) => entry.tagKey)).toEqual(['client', 'lead'])
    expect(keys(listed[0]?.type)).toEqual(['contract'])
  })

  it('leaves private child tags out of an outbound collection', async () => {
    privateParent()
    await refreshTagTypeResolutions(1)
    const local = await listCollection('client')
    expect(local.map((entry) => entry.path).sort()).toEqual(['people/acme.md', 'people/x.md'])
    const outbound = await listCollection('client', [], { excludePrivate: true })
    expect(outbound.map((entry) => entry.path)).toEqual(['people/acme.md'])
  })
})
