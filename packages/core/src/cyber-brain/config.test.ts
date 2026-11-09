import { beforeEach, describe, expect, it, vi } from 'vitest'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
vi.mock('../graph/commands', () => ({ readNote }))

const { cyberBrainDailyPath, isSafeVaultFolder, loadCyberBrainConfig, parseCyberBrainConfig } =
  await import('./config')

/** The frontmatter of a real cyber-brain AGENTS.md (marioverse.ai, 2026-11-09). */
const MARIOVERSE = `---
cyber_brain: "0.1"
owner: "Mario"
language: "it"
writers: "direct"
git: true
daily_notes: "Journal/Daily/DD-MM-YYYY.md"
daily_heading: "### 🤖 Agents"
link_style: wikilink
sensitivity_default: personal
agents:
  - exo
  - claude-code
paths:
  system: System
  inbox: _inbox
content:
  projects: Active/Projects
  people: CRM/People
---

<!-- cyber-brain:begin v0.1 -->
# AGENTS.md
`

beforeEach(() => {
  readNote.mockReset()
})

describe('parseCyberBrainConfig', () => {
  it('reads a real configuration', () => {
    expect(parseCyberBrainConfig(MARIOVERSE)).toEqual({
      version: '0.1',
      owner: 'Mario',
      language: 'it',
      writers: 'direct',
      git: true,
      dailyNotes: 'Journal/Daily/DD-MM-YYYY.md',
      dailyHeading: '### 🤖 Agents',
      linkStyle: 'wikilink',
      sensitivityDefault: 'personal',
      agents: ['exo', 'claude-code'],
      systemPath: 'System',
      inboxPath: '_inbox',
      content: { projects: 'Active/Projects', people: 'CRM/People' },
      scriptPath: 'System/scripts/brain.mjs',
    })
  })

  it('is null for a contract that does not declare cyber-brain', () => {
    expect(parseCyberBrainConfig('# Rules\n\nBe kind.\n')).toBeNull()
    expect(parseCyberBrainConfig('---\nowner: Ada\n---\n# Rules\n')).toBeNull()
    expect(parseCyberBrainConfig('---\ncyber_brain: ""\n---\n')).toBeNull()
  })

  it('is null for a private contract or unreadable frontmatter', () => {
    expect(parseCyberBrainConfig('---\ncyber_brain: "0.1"\nprivate: true\n---\n')).toBeNull()
    expect(parseCyberBrainConfig('---\ncyber_brain: "0.1"\nsensitivity: private\n---\n')).toBeNull()
    expect(parseCyberBrainConfig('---\ncyber_brain: [\n---\n')).toBeNull()
  })

  it('fills the kit defaults and survives bad fields', () => {
    const config = parseCyberBrainConfig(
      '---\ncyber_brain: 0.1\nwriters: sometimes\ngit: maybe\nagents: codex\n---\n',
    )
    expect(config).toMatchObject({
      version: '0.1',
      writers: 'inbox',
      git: false,
      dailyNotes: null,
      dailyHeading: '### Agents',
      agents: [],
      systemPath: 'System',
      inboxPath: '_inbox',
      scriptPath: 'System/scripts/brain.mjs',
    })
  })

  it('never lets a path point outside the vault', () => {
    const config = parseCyberBrainConfig(
      '---\ncyber_brain: "0.1"\npaths:\n  system: ../etc\n  inbox: /tmp\ncontent:\n  people: CRM/People\n---\n',
    )
    expect(config?.systemPath).toBe('System')
    expect(config?.inboxPath).toBe('_inbox')
    expect(config?.scriptPath).toBe('System/scripts/brain.mjs')
  })

  it('follows a custom system folder', () => {
    const config = parseCyberBrainConfig(
      '---\ncyber_brain: "0.1"\npaths:\n  system: brain/kit\n---\n',
    )
    expect(config?.scriptPath).toBe('brain/kit/scripts/brain.mjs')
  })
})

describe('isSafeVaultFolder', () => {
  it('accepts plain relative folders only', () => {
    expect(isSafeVaultFolder('System')).toBe(true)
    expect(isSafeVaultFolder('CRM/People')).toBe(true)
    for (const bad of ['', '/abs', 'a/../b', './x', 'a//b', String.raw`a\b`, '..']) {
      expect(isSafeVaultFolder(bad)).toBe(false)
    }
  })
})

describe('cyberBrainDailyPath', () => {
  it('spells the date the way the vault does', () => {
    const config = parseCyberBrainConfig(MARIOVERSE)!
    expect(cyberBrainDailyPath(config, '2026-11-09')).toBe('Journal/Daily/09-11-2026.md')
    expect(cyberBrainDailyPath(config, '9 nov')).toBeNull()
  })

  it('is null when the brain keeps no daily notes', () => {
    const config = parseCyberBrainConfig('---\ncyber_brain: "0.1"\n---\n')!
    expect(cyberBrainDailyPath(config, '2026-11-09')).toBeNull()
  })
})

describe('loadCyberBrainConfig', () => {
  it('reads the vault AGENTS.md', async () => {
    readNote.mockResolvedValue(MARIOVERSE)
    expect((await loadCyberBrainConfig())?.version).toBe('0.1')
    expect(readNote).toHaveBeenCalledWith('AGENTS.md')
  })

  it('is null when the vault has no AGENTS.md', async () => {
    readNote.mockRejectedValue(new Error('missing'))
    expect(await loadCyberBrainConfig()).toBeNull()
  })
})
