import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CyberBrainConfig } from './config'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const listFiles = vi.hoisted(() => vi.fn())
vi.mock('../graph/commands', () => ({ readNote, listFiles }))

const { loadMemoryOverview, parseMemoryLoops, parseMemoryRuns } = await import('./memory-view')

const config = { systemPath: 'System' } as CyberBrainConfig

const LOOPS = `# Loops

## loop-alice
- title: Risentire Alice per Arcaplanet
- opened: 2026-11-10
- resurface: 2026-11-13
- status: open
- owner: user
- state: open

[[Alice]]

## loop-old
- title: Old thing
- opened: 2026-10-01
- status: closed
- state: done

## loop-bob
- title: Bob owes the deck
- opened: 2026-11-09
- status: waiting-user
- state: waiting
`

const RUNS = `---
description: Run log
---
# Runs 2026-11

## 2026-11-10T09:31:58Z kore-chat remember
- agent: kore-chat
- skill: remember
- by: user
- outcome: ok
- summary: stored fact: Alice segue il pricing
- write: CRM/People/Alice.md | (none) | - Alice segue il pricing [source: chat; since: 2026-11-10]
- commit: 0ff9c38

## 2026-11-10T10:00:00Z claude-code loop
- agent: claude-code
- summary: opened loop-bob
`

beforeEach(() => {
  readNote.mockReset()
  listFiles.mockReset()
})

describe('kit file parsers', () => {
  it('reads loops with their fields', () => {
    const loops = parseMemoryLoops(LOOPS)
    expect(loops.map((loop) => loop.id)).toEqual(['loop-alice', 'loop-old', 'loop-bob'])
    expect(loops[0]).toMatchObject({
      title: 'Risentire Alice per Arcaplanet',
      resurface: '2026-11-13',
    })
  })

  it('reads run records and the lines they wrote', () => {
    const runs = parseMemoryRuns(RUNS)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ agent: 'kore-chat', skill: 'remember', commit: '0ff9c38' })
    expect(runs[0]!.writes[0]).toEqual({
      path: 'CRM/People/Alice.md',
      before: '(none)',
      after: '- Alice segue il pricing [source: chat; since: 2026-11-10]',
    })
    expect(runs[1]).toMatchObject({ agent: 'claude-code', skill: 'loop', commit: null })
  })
})

describe('loadMemoryOverview', () => {
  it('gathers NOW, open loops, decisions and runs from the kit files', async () => {
    listFiles.mockResolvedValue([
      { path: 'System/identity/NOW.md' },
      { path: 'System/memory/loops.md' },
      { path: 'System/memory/decisions/2026-11-07-vault-migrato.md' },
      { path: 'System/memory/decisions/2026-11-10-memoria-via-kore-mcp.md' },
      { path: 'System/memory/decisions/secret.md' },
      { path: 'System/memory/decisions/archive/old.md' },
      { path: 'System/runs/2026-10.md' },
      { path: 'System/runs/2026-11.md' },
    ])
    readNote.mockImplementation(async (path: string) => {
      if (path.endsWith('NOW.md')) return '---\ndescription: now\n---\nShipping Kore memory.\n'
      if (path.endsWith('loops.md')) return LOOPS
      if (path.endsWith('2026-11.md')) return RUNS
      if (path.endsWith('2026-10.md')) return '# Runs 2026-10\n'
      if (path.endsWith('secret.md')) return '---\nsensitivity: private\n---\n# Secret\n'
      if (path.includes('memoria'))
        return '---\ndescription: Come arriva la memoria\n---\n# Memoria via kore mcp\n'
      return '# Vault migrato a cyber-brain\n'
    })
    const overview = await loadMemoryOverview(config)
    expect(overview.now).toEqual({ path: 'System/identity/NOW.md', body: 'Shipping Kore memory.' })
    expect(overview.openLoops.map((loop) => loop.id)).toEqual(['loop-alice', 'loop-bob'])
    expect(overview.closedLoops).toBe(1)
    expect(overview.decisions.map((decision) => decision.title)).toEqual([
      'Memoria via kore mcp',
      'Vault migrato a cyber-brain',
    ])
    expect(overview.decisions[0]).toMatchObject({
      date: '2026-11-10',
      description: 'Come arriva la memoria',
    })
    expect(overview.runs.map((run) => run.agent)).toEqual(['claude-code', 'kore-chat'])
  })

  it('reads an empty memory when the kit files are missing', async () => {
    listFiles.mockResolvedValue([])
    readNote.mockRejectedValue(new Error('missing'))
    const overview = await loadMemoryOverview(config)
    expect(overview).toMatchObject({ now: null, openLoops: [], decisions: [], runs: [] })
  })
})
