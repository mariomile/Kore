import { describe, expect, it } from 'vitest'
import { planTagRename, renameTagInSource, tagRenameProblem } from './tag-rename'

const rename = { from: 'type/project', to: 'project' }

describe('renameTagInSource', () => {
  it('renames frontmatter lists, nested tags and body hashtags, touching nothing else', () => {
    const long = 'x'.repeat(120)
    const source = [
      '---',
      `description: "${long}"`,
      'tags:',
      '  - type/project',
      '  - "#type/project/client"',
      '  - domain/tools',
      '---',
      '# Atlas #type/project',
      '',
      'See `#type/project` and [[type/project]].',
      '',
    ].join('\n')
    expect(renameTagInSource(source, rename)).toBe(
      [
        '---',
        `description: "${long}"`,
        'tags:',
        '  - project',
        '  - "#project/client"',
        '  - domain/tools',
        '---',
        '# Atlas #project',
        '',
        'See `#type/project` and [[type/project]].',
        '',
      ].join('\n'),
    )
  })

  it('keeps flow lists and string values in their own style', () => {
    expect(renameTagInSource('---\ntags: ["type/project", "a"]\n---\nBody\n', rename)).toBe(
      '---\ntags: ["project", "a"]\n---\nBody\n',
    )
    expect(renameTagInSource('---\ntags: a, type/project\n---\n', rename)).toBe(
      '---\ntags: a, project\n---\n',
    )
  })

  it('drops the entry a merge duplicates, in block and flow lists', () => {
    expect(renameTagInSource('---\ntags:\n  - project\n  - type/project\n---\n', rename)).toBe(
      '---\ntags:\n  - project\n---\n',
    )
    expect(renameTagInSource('---\ntags: ["type/project", "project"]\n---\n', rename)).toBe(
      '---\ntags: ["project"]\n---\n',
    )
  })

  it('leaves a note without the tag alone', () => {
    expect(renameTagInSource('---\ntags: [type/projects]\n---\n#typeX\n', rename)).toBeNull()
  })

  it('rewrites a definition’s extends and relation target', () => {
    const definition =
      '---\nkore: tag\nextends: type/project\nproperties:\n  - key: parent\n    type: relation\n    target: type/project\n---\n'
    expect(renameTagInSource(definition, rename)).toBe(
      '---\nkore: tag\nextends: project\nproperties:\n  - key: parent\n    type: relation\n    target: project\n---\n',
    )
  })
})

describe('planTagRename', () => {
  it('moves the definition, or keeps it when the new name already has one', () => {
    const notes = [{ path: 'a.md', source: '#type/project\n' }]
    const free = planTagRename(rename, {
      notes,
      definitions: [{ tagKey: 'type/project', notePath: 'tags/type/project.md' }],
      tags: ['type/project', 'type/project/client'],
    })
    expect(free.writes).toHaveLength(1)
    expect(free.moves).toEqual([{ from: 'tags/type/project.md', to: 'tags/project.md' }])
    expect(free.nestedTags).toEqual(['project/client'])
    expect(free.merges).toBe(false)

    const taken = planTagRename(rename, {
      notes,
      definitions: [
        { tagKey: 'type/project', notePath: 'tags/type/project.md' },
        { tagKey: 'project', notePath: 'tags/project.md' },
      ],
      tags: ['type/project', 'project'],
    })
    expect(taken.moves).toEqual([])
    expect(taken.keptDefinitions).toEqual(['tags/type/project.md'])
    expect(taken.merges).toBe(true)
  })
})

describe('tagRenameProblem', () => {
  it('refuses an empty, invalid or unchanged name', () => {
    expect(tagRenameProblem({ from: 'a', to: ' ' })).not.toBeNull()
    expect(tagRenameProblem({ from: 'a', to: '1x' })).not.toBeNull()
    expect(tagRenameProblem({ from: 'a', to: '#a' })).not.toBeNull()
    expect(tagRenameProblem({ from: 'a', to: 'A' })).toBeNull()
  })
})
