import { beforeEach, describe, expect, it, vi } from 'vitest'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const listFiles = vi.hoisted(() => vi.fn())
vi.mock('../graph/commands', () => ({ readNote, listFiles }))

const { listVaultSkills, vaultSkillsPromptLines, VAULT_SKILLS_MAX } = await import('./vault-skills')

beforeEach(() => {
  readNote.mockReset()
  listFiles.mockReset()
})

describe('listVaultSkills', () => {
  it('reads a kit vault’s folder-per-skill layout (Plan 35)', async () => {
    listFiles.mockResolvedValue([
      { path: 'System/skills/remember/SKILL.md' },
      { path: 'System/skills/recall/SKILL.md' },
      { path: 'System/skills/recall/notes.md' },
      { path: 'System/skills.md' },
      { path: 'agents/skills/kore.md' },
    ])
    readNote.mockImplementation(async (path: string) =>
      path.includes('remember')
        ? '---\ndescription: Keep a durable fact\n---\n# Remember\n\nSteps\n'
        : '# Recall\n\nSteps\n',
    )
    const layout = { dir: 'System/skills', kind: 'folder' } as const
    const skills = await listVaultSkills(layout)
    expect(skills.map((skill) => skill.path)).toEqual([
      'System/skills/recall/SKILL.md',
      'System/skills/remember/SKILL.md',
    ])
    expect(vaultSkillsPromptLines(skills, layout)[1]).toContain(
      'one SKILL.md each under System/skills/<name>/',
    )
  })

  it('lists skills with H1 names and frontmatter descriptions, A→Z', async () => {
    listFiles.mockResolvedValue([
      { path: 'notes/other.md' },
      { path: 'agents/skills/weekly-review.md' },
      { path: 'agents/skills/deploy.md' },
      { path: 'agents/skills/nested/never.md' },
      { path: 'agents/user.md' },
    ])
    readNote.mockImplementation(async (path: string) =>
      path === 'agents/skills/deploy.md'
        ? '---\ndescription: Ship a release end to end\n---\n# Deploy Kore\n\n1. Merge\n2. Bump\n'
        : '# Weekly review\n\nSteps…\n',
    )
    const skills = await listVaultSkills()
    expect(skills).toEqual([
      {
        slug: 'deploy',
        path: 'agents/skills/deploy.md',
        name: 'Deploy Kore',
        description: 'Ship a release end to end',
      },
      {
        slug: 'weekly-review',
        path: 'agents/skills/weekly-review.md',
        name: 'Weekly review',
        description: '',
      },
    ])
  })

  it('skips private, empty, and unreadable skills without failing the catalog', async () => {
    listFiles.mockResolvedValue([
      { path: 'agents/skills/hidden.md' },
      { path: 'agents/skills/empty.md' },
      { path: 'agents/skills/broken.md' },
      { path: 'agents/skills/good.md' },
    ])
    readNote.mockImplementation(async (path: string) => {
      if (path.endsWith('hidden.md')) return '---\nprivate: true\n---\n# Hidden\n\nsecret steps\n'
      if (path.endsWith('empty.md')) return '---\ndescription: nothing\n---\n\n'
      if (path.endsWith('broken.md')) throw new Error('io')
      return '# Good\n\nsteps\n'
    })
    const skills = await listVaultSkills()
    expect(skills.map((skill) => skill.slug)).toEqual(['good'])
  })

  it('caps the catalog and degrades to empty when listing fails', async () => {
    listFiles.mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => ({
        path: `agents/skills/s${String(index).padStart(2, '0')}.md`,
      })),
    )
    readNote.mockResolvedValue('# S\n\nbody\n')
    expect(await listVaultSkills()).toHaveLength(VAULT_SKILLS_MAX)

    listFiles.mockRejectedValue(new Error('no bridge'))
    expect(await listVaultSkills()).toEqual([])
  })
})

describe('vaultSkillsPromptLines', () => {
  it('is silent with no skills and lists name, description, and path with some', () => {
    expect(vaultSkillsPromptLines([])).toEqual([])
    const lines = vaultSkillsPromptLines([
      {
        slug: 'deploy',
        path: 'agents/skills/deploy.md',
        name: 'Deploy Kore',
        description: 'Ship a release',
      },
    ])
    expect(lines.join('\n')).toContain('read its file and follow it')
    expect(lines.join('\n')).toContain('- Deploy Kore — Ship a release (agents/skills/deploy.md)')
  })
})
