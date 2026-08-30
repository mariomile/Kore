import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { parseNote } from '../markdown'
import {
  DEFAULT_VAULT_OBJECTS,
  defaultObjectSource,
  writeDefaultVaultObjects,
} from './default-objects'
import { isPropertyKey, parseTagTypeFrontmatter } from './tag-type'

afterEach(() => {
  setBridge(null)
})

describe('defaultObjectSource', () => {
  it('writes exactly what the tag-type reader recognizes, for every object', () => {
    for (const object of DEFAULT_VAULT_OBJECTS) {
      const source = defaultObjectSource(object)
      const parsed = parseNote({ path: `tags/${object.tag.toLowerCase()}.md`, source })
      const type = parseTagTypeFrontmatter(parsed.frontmatter)
      expect(type, object.tag).not.toBeNull()
      expect(
        type!.properties.map((property) => [property.name, property.key, property.type]),
        object.tag,
      ).toEqual(object.properties.map((property) => [property.name, property.key, property.type]))
      // The H1 is the tag's display name; the body explains the object.
      expect(parsed.title).toBe(object.tag)
      expect(source.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses only legal, non-reserved property keys', () => {
    for (const object of DEFAULT_VAULT_OBJECTS) {
      for (const property of object.properties) {
        expect(isPropertyKey(property.key), `${object.tag}.${property.key}`).toBe(true)
      }
    }
  })
})

describe('writeDefaultVaultObjects', () => {
  it('creates one definition note per object, never overwriting an existing file', async () => {
    const created: string[] = []
    setBridge({
      invoke: async (command, args) => {
        if (command === 'note_create') {
          created.push(String(args['path']))
          // The second object already exists — find-or-create leaves it be.
          return created.length === 2 ? { kind: 'exists' } : { kind: 'created', modifiedMs: 1 }
        }
        throw new Error(`unexpected command: ${command}`)
      },
      listen: async () => () => {},
    })

    await writeDefaultVaultObjects(7)

    expect(created).toEqual([
      'tags/project.md',
      'tags/person.md',
      'tags/company.md',
      'tags/meeting.md',
    ])
  })

  it('is a data seed only — no routine, workflow, or setting rides along', () => {
    // The automations principle in one assertion: the objects carry schema
    // and prose, nothing executable.
    for (const object of DEFAULT_VAULT_OBJECTS) {
      expect(Object.keys(object).sort()).toEqual(['body', 'properties', 'tag'])
    }
    expect(vi.isMockFunction(writeDefaultVaultObjects)).toBe(false)
  })
})
