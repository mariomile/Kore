import { beforeEach, describe, expect, it, vi } from 'vitest'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
vi.mock('../graph/commands', () => ({ readNote }))

const { AGENT_MEMORY_MAX_CHARS, AGENT_MEMORY_PATH, agentMemoryPromptLines, loadAgentMemory } =
  await import('./agent-memory')

beforeEach(() => {
  readNote.mockReset()
})

describe('loadAgentMemory', () => {
  it('reads the memory note body with frontmatter stripped', async () => {
    readNote.mockResolvedValue('---\nid: abc\n---\n# Agent Memory\n\n- Prefers Italian\n')
    await expect(loadAgentMemory()).resolves.toEqual({
      body: '# Agent Memory\n\n- Prefers Italian',
      truncated: false,
    })
    expect(readNote).toHaveBeenCalledWith(AGENT_MEMORY_PATH)
  })

  it('returns null for a missing, empty, or private memory note', async () => {
    readNote.mockRejectedValue(new Error('not found'))
    await expect(loadAgentMemory()).resolves.toBeNull()

    readNote.mockResolvedValue('---\nid: abc\n---\n\n')
    await expect(loadAgentMemory()).resolves.toBeNull()

    readNote.mockResolvedValue('---\nprivate: true\n---\n# Agent Memory\nsecret prefs\n')
    await expect(loadAgentMemory()).resolves.toBeNull()
  })

  it('caps oversized memory and flags the truncation', async () => {
    readNote.mockResolvedValue(`# M\n${'x'.repeat(AGENT_MEMORY_MAX_CHARS + 100)}`)
    const memory = await loadAgentMemory()
    expect(memory?.truncated).toBe(true)
    expect(memory?.body.length).toBe(AGENT_MEMORY_MAX_CHARS)
  })
})

describe('agentMemoryPromptLines', () => {
  it('carries the memory block plus the edit-mode upkeep instruction', () => {
    const lines = agentMemoryPromptLines(
      { body: '- Prefers Italian', truncated: false },
      { canEdit: true },
    ).join('\n')
    expect(lines).toContain('- Prefers Italian')
    expect(lines).toContain('[[Agent Memory]]')
    expect(lines).toContain('record it in notes/agent-memory.md')
    expect(lines).not.toContain('cannot edit')
  })

  it('tells a read-only session to suggest, never to claim a save', () => {
    const lines = agentMemoryPromptLines(null, { canEdit: false }).join('\n')
    expect(lines).toContain('cannot edit notes in this mode')
    expect(lines).toContain('never claim to have saved it')
  })

  it('marks a truncated memory so the agent prunes it', () => {
    const lines = agentMemoryPromptLines({ body: 'long', truncated: true }, { canEdit: true }).join(
      '\n',
    )
    expect(lines).toContain('needs pruning')
  })
})
