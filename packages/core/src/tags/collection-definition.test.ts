import { describe, expect, it } from 'vitest'
import {
  parseCollectionDefinitionSource,
  updateCollectionDefinitionSource,
  type CollectionDefinitionConfig,
} from './collection-definition'

const config: CollectionDefinitionConfig = {
  version: 1,
  sources: {
    tags: ['project', 'initiative'],
    relation: { key: 'project', target: '[[Kore]]' },
    include: ['01MANUAL'],
    exclude: ['notes/archived.md'],
  },
  create: { tag: 'project', properties: { status: 'active' } },
}

describe('collection definitions', () => {
  it('writes a fresh definition into a note that has no Kore namespace', () => {
    const updated = updateCollectionDefinitionSource(
      ['---', 'id: 01COLLECTION', '---', '# Active work'].join('\n'),
      config,
    )

    expect(parseCollectionDefinitionSource(updated, 'notes/active-work.md')?.config).toEqual(config)
  })

  it('updates and parses a normal note while preserving sibling config and body', () => {
    const source = [
      '---',
      'id: 01COLLECTION',
      'kore:',
      '  other: keep',
      '---',
      '# Active work',
      'Body',
    ].join('\n')
    const updated = updateCollectionDefinitionSource(source, config)
    expect(updated).toContain('other: keep')
    expect(updated).toContain('koreCollection: true')
    expect(updated.endsWith('# Active work\nBody')).toBe(true)
    expect(parseCollectionDefinitionSource(updated, 'notes/active-work.md')).toEqual({
      id: '01COLLECTION',
      path: 'notes/active-work.md',
      title: 'Active work',
      config,
    })
  })

  it('rejects malformed config and reserved creation properties', () => {
    expect(
      parseCollectionDefinitionSource(
        [
          '---',
          'koreCollection: true',
          'kore:',
          '  collection:',
          '    version: 1',
          '    sources: { tags: [] }',
          '    create:',
          '      properties: { private: true }',
          '---',
          '# Broken',
        ].join('\n'),
        'notes/broken.md',
      ),
    ).toBeNull()
  })
})
