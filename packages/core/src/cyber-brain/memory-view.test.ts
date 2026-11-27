import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CyberBrainConfig } from './config'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const listFiles = vi.hoisted(() => vi.fn())
vi.mock('../graph/commands', () => ({ readNote, listFiles }))

const {
  episodeEntry,
  loadMemoryOverview,
  memoryFileChanges,
  parseMemoryEpisode,
  parseMemoryLoops,
  parseMemoryRuns,
} = await import('./memory-view')

const config = {
  systemPath: 'System',
  episodesPath: 'System/memory/episodes',
} as CyberBrainConfig

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

// Written by `brain.mjs episode` (kit 0.3), unedited.
const EPISODE_PATH = 'System/memory/episodes/2026/11/2026-11-27-1706-elevenlabs-product-case.md'
const EPISODE = `---
description: ElevenLabs product case. What claude-code did in this session and what it learned.
type: episode
agent: claude-code
date: 2026-11-27
started: 2026-11-27T17:06:25Z
ended: 2026-11-27T17:24:10Z
duration_min: 18
by: user
touched:
  - "[[Sara Bianchi]]"
runs:
  - "2026-11-27T17:06:25Z claude-code remember"
---
# ElevenLabs product case

Read the brief, outlined the case. Agreed to lead with latency.

## Learned

- Sara prefers a written doc over slides -> [[Sara Bianchi]]
- Round two is due 4 Dec (waiting for dream)
`

const EPISODE_RUNS = `# Runs 2026-11

## 2026-11-27T17:06:25Z claude-code remember
- agent: claude-code
- skill: remember
- summary: stored fact: Sara leads design
- write: CRM/People/Sara Bianchi.md | (none) | - Sara leads design [source: call; since: 2026-11-27]

## 2026-11-27T17:06:25Z claude-code remember
- agent: claude-code
- skill: remember
- summary: a second run in the same second

## 2026-11-27T17:24:10Z claude-code episode
- agent: claude-code
- skill: episode
- summary: episode: ElevenLabs product case (2 facts, 1 run)
- episode: ${EPISODE_PATH}
- write: ${EPISODE_PATH} | (new file) | # ElevenLabs product case
- write: CRM/People/Sara Bianchi.md | (none) | - Sara prefers a written doc over slides [source: [[2026-11-27-1706-elevenlabs-product-case]]; since: 2026-11-27]
- write: System/memory/inbox/claude-code/2026-11-27.md | (none) | - [fact] Round two is due 4 Dec -> ? [source: [[2026-11-27-1706-elevenlabs-product-case]]; since: 2026-11-27]
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

  it('names a repeated run heading the way the kit does', () => {
    const runs = parseMemoryRuns(EPISODE_RUNS)
    expect(runs.map((run) => run.key)).toEqual([
      '2026-11-27T17:06:25Z claude-code remember',
      '2026-11-27T17:06:25Z claude-code remember #2',
      '2026-11-27T17:24:10Z claude-code episode',
    ])
    expect(runs[2]).toMatchObject({ episode: EPISODE_PATH, undoes: null })
  })

  it('reads an episode the kit wrote', () => {
    expect(parseMemoryEpisode(EPISODE_PATH, EPISODE)).toEqual({
      path: EPISODE_PATH,
      title: 'ElevenLabs product case',
      summary: 'Read the brief, outlined the case. Agreed to lead with latency.',
      agent: 'claude-code',
      started: '2026-11-27T17:06:25Z',
      ended: '2026-11-27T17:24:10Z',
      durationMin: 18,
      touched: ['Sara Bianchi'],
      learned: [
        { text: 'Sara prefers a written doc over slides', note: 'Sara Bianchi', queued: false },
        { text: 'Round two is due 4 Dec', note: null, queued: true },
      ],
      runKeys: ['2026-11-27T17:06:25Z claude-code remember'],
    })
  })

  it('skips notes that are not episodes, or are private', () => {
    expect(parseMemoryEpisode('a.md', '# Just a note\n')).toBeNull()
    expect(parseMemoryEpisode('a.md', '---\ntype: episode\nprivate: true\n---\n# x\n')).toBeNull()
  })

  it('joins an episode to the lines its runs wrote, without its own note', () => {
    const episode = parseMemoryEpisode(EPISODE_PATH, EPISODE)!
    const entry = episodeEntry(episode, parseMemoryRuns(EPISODE_RUNS), 'System')
    expect(entry.writes.map((write) => write.after)).toEqual([
      '- Sara leads design [source: call; since: 2026-11-27]',
      '- Sara prefers a written doc over slides [source: [[2026-11-27-1706-elevenlabs-product-case]]; since: 2026-11-27]',
      '- [fact] Round two is due 4 Dec -> ? [source: [[2026-11-27-1706-elevenlabs-product-case]]; since: 2026-11-27]',
    ])
  })
})

describe('memoryFileChanges', () => {
  it('turns writes into per-file diff lines and skips the kit markers', () => {
    expect(
      memoryFileChanges([
        { path: 'A.md', before: 'Stage: first call', after: 'Stage: second round' },
        { path: 'B.md', before: '(new file)', after: '# B' },
        { path: 'A.md', before: '(none)', after: 'Case reviewed by Sara' },
        { path: 'C.md', before: '(whole file)', after: '(archived)' },
      ]),
    ).toEqual([
      {
        path: 'A.md',
        lines: [
          { sign: '-', text: 'Stage: first call' },
          { sign: '+', text: 'Stage: second round' },
          { sign: '+', text: 'Case reviewed by Sara' },
        ],
        added: 2,
        removed: 1,
      },
      { path: 'B.md', lines: [{ sign: '+', text: '# B' }], added: 1, removed: 0 },
    ])
  })
})

describe('loadMemoryOverview', () => {
  it('gathers NOW, transit, exclusions, open loops, decisions and runs from the kit files', async () => {
    listFiles.mockResolvedValue([
      { path: 'System/identity/NOW.md' },
      { path: 'System/identity/USER.md' },
      { path: 'System/memory/loops.md' },
      { path: 'System/memory/exclusions.md' },
      { path: 'System/memory/inbox/z-agent/2026-01-01.md' },
      { path: 'System/memory/inbox/chatgpt/2026-11-21.md' },
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
      if (path.endsWith('exclusions.md'))
        return '---\ndescription: exclusions\n---\n# Exclusions\n- Acme Corp [reason: former client; since: 2026-11-21]\n'
      if (path.endsWith('inbox/chatgpt/2026-11-21.md'))
        return '# Transit 2026-11-21\n- [observation] Prefers concise replies -> ? [source: ChatGPT; since: 2025-04-02]\n'
      if (path.endsWith('inbox/z-agent/2026-01-01.md'))
        return '# Transit 2026-01-01\n- [fact] Older queued item -> ? [source: z-agent; since: 2026-01-01]\n'
      if (path.endsWith('2026-11.md')) return RUNS
      if (path.endsWith('2026-10.md')) return '# Runs 2026-10\n'
      if (path.endsWith('secret.md')) return '---\nsensitivity: private\n---\n# Secret\n'
      if (path.includes('memoria'))
        return '---\ndescription: Come arriva la memoria\n---\n# Memoria via kore mcp\n'
      return '# Vault migrato a cyber-brain\n'
    })
    const overview = await loadMemoryOverview(config)
    expect(overview.now).toEqual({ path: 'System/identity/NOW.md', body: 'Shipping Kore memory.' })
    expect(overview.userPath).toBe('System/identity/USER.md')
    expect(overview.soulPath).toBeNull()
    expect(overview.transit).toEqual([
      {
        path: 'System/memory/inbox/chatgpt/2026-11-21.md',
        agent: 'chatgpt',
        kind: 'observation',
        text: 'Prefers concise replies',
        target: '?',
        source: 'ChatGPT',
        since: '2025-04-02',
        was: null,
      },
      {
        path: 'System/memory/inbox/z-agent/2026-01-01.md',
        agent: 'z-agent',
        kind: 'fact',
        text: 'Older queued item',
        target: '?',
        source: 'z-agent',
        since: '2026-01-01',
        was: null,
      },
    ])
    expect(overview.exclusions).toEqual([
      { topic: 'Acme Corp', reason: 'former client', since: '2026-11-21' },
    ])
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
    expect(overview.episodes).toEqual([])
  })

  it('lists episodes newest first, with what they changed', async () => {
    const older = 'System/memory/episodes/2026/10/2026-10-30-0900-older.md'
    listFiles.mockResolvedValue([
      { path: older },
      { path: EPISODE_PATH },
      { path: 'System/runs/2026-11.md' },
    ])
    readNote.mockImplementation(async (path: string) => {
      if (path === EPISODE_PATH) return EPISODE
      if (path === older) return '---\ntype: episode\nagent: codex\n---\n# Older\n\nDone.\n'
      return EPISODE_RUNS
    })
    const overview = await loadMemoryOverview(config)
    expect(overview.episodes.map((episode) => episode.title)).toEqual([
      'ElevenLabs product case',
      'Older',
    ])
    expect(overview.episodes[0]!.writes).toHaveLength(3)
    expect(overview.episodes[1]).toMatchObject({ agent: 'codex', summary: 'Done.', writes: [] })
  })

  it('reads an empty memory when the kit files are missing', async () => {
    listFiles.mockResolvedValue([])
    readNote.mockRejectedValue(new Error('missing'))
    const overview = await loadMemoryOverview(config)
    expect(overview).toMatchObject({
      now: null,
      openLoops: [],
      decisions: [],
      runs: [],
      episodes: [],
    })
  })
})
