import { beforeEach, describe, expect, it, vi } from 'vitest'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const listFiles = vi.hoisted(() => vi.fn())
const createNoteIfAbsent = vi.hoisted(() => vi.fn())
vi.mock('../graph/commands', () => ({ readNote, listFiles, createNoteIfAbsent }))

const {
  AGENT_MEMORY_MAX_CHARS,
  agentContextPromptLines,
  createAgentProfile,
  listAgentProfiles,
  loadAgentContext,
} = await import('./agent-profiles')

const SOUL = '---\nprovider: codex-cli\nmodel: gpt-5\n---\n# Riley\n\nSpeak plainly.\n'

beforeEach(() => {
  readNote.mockReset()
  listFiles.mockReset()
  createNoteIfAbsent.mockReset()
})

describe('listAgentProfiles', () => {
  it('finds profiles by their soul files and reads name and provider pin', async () => {
    listFiles.mockResolvedValue([
      { path: 'notes/other.md' },
      { path: 'agents/riley/soul.md' },
      { path: 'agents/riley/memory.md' },
      { path: 'agents/coach/soul.md' },
      { path: 'agents/user.md' },
    ])
    readNote.mockImplementation(async (path: string) =>
      path === 'agents/riley/soul.md' ? SOUL : '# Coach\n\nbody\n',
    )
    const profiles = await listAgentProfiles()
    expect(profiles.map((profile) => profile.slug)).toEqual(['coach', 'riley'])
    expect(profiles[1]).toMatchObject({
      name: 'Riley',
      provider: 'codex-cli',
      model: 'gpt-5',
      soulPath: 'agents/riley/soul.md',
      memoryPath: 'agents/riley/memory.md',
    })
  })
})

describe('loadAgentContext', () => {
  it('loads soul, shared user memory, and the profile memory', async () => {
    readNote.mockImplementation(async (path: string) => {
      if (path === 'agents/riley/soul.md') return SOUL
      if (path === 'agents/user.md') return '- Prefers Italian\n'
      if (path === 'agents/riley/memory.md') return '- Project X ships Friday\n'
      throw new Error('unexpected read')
    })
    const context = await loadAgentContext('riley')
    expect(context.profile?.name).toBe('Riley')
    expect(context.soul?.body).toBe('# Riley\n\nSpeak plainly.')
    expect(context.userMemory?.body).toBe('- Prefers Italian')
    expect(context.agentMemory?.body).toBe('- Project X ships Friday')
    expect(context.memoryPath).toBe('agents/riley/memory.md')
  })

  it('falls back to the default assistant when there is no profile', async () => {
    readNote.mockRejectedValue(new Error('missing'))
    const context = await loadAgentContext(null)
    expect(context.profile).toBeNull()
    expect(context.soul).toBeNull()
    expect(context.memoryPath).toBe('agents/assistant/memory.md')
  })

  it('honors private: a private soul or memory never loads', async () => {
    readNote.mockImplementation(async (path: string) => {
      if (path === 'agents/riley/soul.md') return '---\nprivate: true\n---\n# Riley\nsecret\n'
      throw new Error('missing')
    })
    const context = await loadAgentContext('riley')
    expect(context.soul).toBeNull()
  })
})

describe('agentContextPromptLines', () => {
  const context = {
    profile: {
      slug: 'riley',
      name: 'Riley',
      provider: null,
      model: null,
      soulPath: 'agents/riley/soul.md',
      memoryPath: 'agents/riley/memory.md',
    },
    soul: { body: 'Speak plainly.', truncated: false },
    userMemory: { body: '- Prefers Italian', truncated: false },
    agentMemory: { body: 'x'.repeat(AGENT_MEMORY_MAX_CHARS), truncated: true },
    memoryPath: 'agents/riley/memory.md',
  }

  it('puts the soul first and points upkeep at both memory files', () => {
    const lines = agentContextPromptLines(context, { canEdit: true }).join('\n')
    expect(lines.indexOf('Speak plainly.')).toBeLessThan(lines.indexOf('- Prefers Italian'))
    expect(lines).toContain('agents/user.md')
    expect(lines).toContain('agents/riley/memory.md')
    expect(lines).toContain('consolidate before adding more')
    expect(lines).not.toContain('cannot edit')
  })

  it('read-only upkeep suggests instead of saving', () => {
    const lines = agentContextPromptLines(null, { canEdit: false }).join('\n')
    expect(lines).toContain('cannot edit notes in this mode')
    expect(lines).toContain('agents/assistant/memory.md')
    expect(lines).toContain('never claim to have saved it')
  })
})

describe('createAgentProfile', () => {
  it('claims a collision-free slug and seeds soul and memory', async () => {
    createNoteIfAbsent
      .mockResolvedValueOnce({ kind: 'exists' })
      .mockResolvedValue({ kind: 'created', modifiedMs: 1 })
    const profile = await createAgentProfile({
      name: 'Riley!',
      provider: 'claude-cli',
      generation: 7,
    })
    expect(profile.slug).toBe('riley-2')
    expect(profile.provider).toBe('claude-cli')
    const soulCall = createNoteIfAbsent.mock.calls[1]
    expect(soulCall?.[0]).toBe('agents/riley-2/soul.md')
    expect(soulCall?.[1]).toContain('provider: claude-cli')
    expect(soulCall?.[1]).toContain('# Riley!')
    expect(createNoteIfAbsent.mock.calls[2]?.[0]).toBe('agents/riley-2/memory.md')
  })
})
