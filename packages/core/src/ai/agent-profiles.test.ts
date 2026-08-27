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
  parsePendingMemory,
  withoutPendingProposal,
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

  it('digests an over-budget memory file to its skeleton, not a head-cut', async () => {
    const facts = [
      '# Shared facts',
      '',
      '## Team',
      '- [certain] Ships on Fridays — riley, 2026-08-01',
      ...Array.from(
        { length: 80 },
        (_, i) => `- [likely] filler fact number ${i} — riley, 2026-08-0${(i % 9) + 1}`,
      ),
      '',
      '## Conventions',
      '- [certain] Conventional commits — riley, 2026-08-02',
    ].join('\n')
    readNote.mockImplementation(async (path: string) => {
      if (path === 'agents/memory/facts.md') return facts
      throw new Error('missing')
    })
    const context = await loadAgentContext(null)
    expect(context.sharedFacts?.truncated).toBe(true)
    // The skeleton keeps every heading and the first fact of each section…
    expect(context.sharedFacts?.body).toContain('## Team')
    expect(context.sharedFacts?.body).toContain('## Conventions')
    expect(context.sharedFacts?.body).toContain('Ships on Fridays')
    expect(context.sharedFacts?.body).toContain('Conventional commits')
    // …and elides the bulk instead of shipping it every turn.
    expect(context.sharedFacts?.body).not.toContain('filler fact number 50')
    expect(context.sharedFacts?.body).toContain('more lines')
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
    sharedFacts: { body: '- [certain] Kore is the app — riley, 2026-08-20', truncated: false },
    sharedLog: { body: '## 2026-08-19 — riley\n- shipped viewer', truncated: false },
    memoryPath: 'agents/riley/memory.md',
  }

  it('puts the soul first and routes upkeep across all memory files', () => {
    const lines = agentContextPromptLines(context, { canEdit: true }).join('\n')
    expect(lines.indexOf('Speak plainly.')).toBeLessThan(lines.indexOf('- Prefers Italian'))
    expect(lines.indexOf('- Prefers Italian')).toBeLessThan(
      lines.indexOf('[certain] Kore is the app'),
    )
    expect(lines).toContain('agents/user.md')
    expect(lines).toContain('agents/memory/facts.md')
    expect(lines).toContain('agents/memory/log.md')
    expect(lines).toContain('shipped viewer')
    expect(lines).toContain('agents/riley/memory.md')
    expect(lines).toContain('[certain|likely|speculative]')
    // The digested memory points at its file instead of apologizing.
    expect(lines).toContain('read agents/riley/memory.md when you need the rest')
    expect(lines).not.toContain('cannot edit')
    expect(lines).not.toContain('pending.md')
  })

  it('write approval reroutes user and shared facts through pending proposals', () => {
    const lines = agentContextPromptLines(context, { canEdit: true, writeApproval: true }).join(
      '\n',
    )
    expect(lines).toContain('agents/memory/pending.md')
    expect(lines).toContain('do NOT edit agents/user.md or agents/memory/facts.md directly')
    expect(lines).toContain('are exempt')
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

describe('pending memory proposals', () => {
  const source = [
    '# Pending',
    '',
    '## 2026-08-20 riley → agents/user.md',
    '- Prefers commit messages in English',
    '',
    '## 2026-08-20 coach → agents/memory/facts.md',
    '- [likely] The team ships on Fridays — coach, 2026-08-20',
    '',
  ].join('\n')

  it('parses proposal sections with their targets and bodies', () => {
    const proposals = parsePendingMemory(source)
    expect(proposals).toHaveLength(2)
    expect(proposals[0]).toMatchObject({
      target: 'agents/user.md',
      body: '- Prefers commit messages in English',
    })
    expect(proposals[1]?.target).toBe('agents/memory/facts.md')
  })

  it('removes exactly one section by its heading', () => {
    const first = parsePendingMemory(source)[0]
    const rest = withoutPendingProposal(source, first?.heading ?? '')
    expect(rest).not.toContain('Prefers commit messages')
    expect(rest).toContain('The team ships on Fridays')
    expect(parsePendingMemory(rest)).toHaveLength(1)
  })

  it('removes only the first of two identically-headed proposals', () => {
    const heading = '## 2026-08-20 assistant → agents/user.md'
    const doubled = `${heading}\n\n- fact one\n\n${heading}\n\n- fact two\n`
    const rest = withoutPendingProposal(doubled, heading)
    expect(rest).not.toContain('fact one')
    expect(rest).toContain('fact two')
    expect(parsePendingMemory(rest)).toHaveLength(1)
  })

  it('tolerates junk and empty proposals', () => {
    expect(parsePendingMemory('no headings here')).toEqual([])
    expect(parsePendingMemory('## 2026-08-20 riley → agents/user.md\n\n')).toEqual([])
  })
})
