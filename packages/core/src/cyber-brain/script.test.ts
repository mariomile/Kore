import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { parseCyberBrainConfig } from './config'
import { brainAgentSlug, brainArgv, brainResult, runBrainCommand } from './script'

const CONFIG = parseCyberBrainConfig('---\ncyber_brain: "0.1"\n---\n')!

afterEach(() => {
  setBridge(null)
})

describe('brainAgentSlug', () => {
  it('keeps names safe to use as a folder', () => {
    expect(brainAgentSlug('Kore')).toBe('kore')
    expect(brainAgentSlug('Claude Code')).toBe('claude-code')
    expect(brainAgentSlug('../../etc')).toBe('etc')
    expect(brainAgentSlug('Emily (Telegram)')).toBe('emily-telegram')
    expect(brainAgentSlug('  ')).toBe('kore')
  })
})

describe('brainArgv', () => {
  const caller = { agent: 'Kore', by: 'user' }

  it('spells a fact the way the kit CLI takes it', () => {
    expect(
      brainArgv(
        {
          kind: 'remember',
          memory: 'fact',
          text: 'Alice leads Product at Digital Pills',
          source: 'chat',
          target: 'CRM/People/Alice Morrone.md',
          now: true,
        },
        caller,
      ),
    ).toEqual([
      'remember',
      '--agent=kore',
      '--by=user',
      '--kind=fact',
      '--text=Alice leads Product at Digital Pills',
      '--source=chat',
      '--target=CRM/People/Alice Morrone.md',
      '--now',
    ])
  })

  it('keeps text that looks like an option inside its own value', () => {
    const argv = brainArgv(
      { kind: 'remember', memory: 'fact', text: '--now --root=/etc', source: 'chat' },
      { agent: 'kore' },
    )
    expect(argv).toContain('--text=--now --root=/etc')
    expect(argv).not.toContain('--now')
    expect(argv.some((arg) => arg.startsWith('--root'))).toBe(false)
  })

  it('opens, updates and closes loops', () => {
    expect(
      brainArgv({ kind: 'loop-open', title: 'Risentire Alice', due: 'venerdì' }, caller),
    ).toEqual([
      'loop',
      'open',
      '--agent=kore',
      '--by=user',
      '--title=Risentire Alice',
      '--due=venerdì',
    ])
    expect(brainArgv({ kind: 'loop-update', id: 'loop-x', state: 'chiamata' }, caller)).toEqual([
      'loop',
      'update',
      '--agent=kore',
      '--by=user',
      '--id=loop-x',
      '--state=chiamata',
    ])
    expect(brainArgv({ kind: 'loop-close', id: 'loop-x', outcome: 'fatto' }, caller)).toEqual([
      'loop',
      'close',
      '--agent=kore',
      '--by=user',
      '--id=loop-x',
      '--outcome=fatto',
    ])
  })

  it('creates a decision', () => {
    expect(
      brainArgv(
        { kind: 'decision', title: 'Kore runs brain.mjs', description: 'd', decision: 'yes' },
        { agent: 'kore' },
      ),
    ).toEqual([
      'decision',
      'new',
      '--agent=kore',
      '--title=Kore runs brain.mjs',
      '--description=d',
      '--decision=yes',
    ])
  })

  it('reads facts and checks without signing', () => {
    expect(brainArgv({ kind: 'facts', query: '--Alice', at: '2026-10-01' }, caller)).toEqual([
      'facts',
      'Alice',
      '--at=2026-10-01',
    ])
    expect(brainArgv({ kind: 'check' }, caller)).toEqual(['check', '--json'])
  })
})

describe('brainResult', () => {
  it('reads the summary and the commit', () => {
    expect(
      brainResult({
        code: 0,
        stdout:
          'note: due read as 2026-11-13\nopened loop-risentire-alice: Risentire Alice (commit 1a2b3c4)\n',
        stderr: '',
        timedOut: false,
      }),
    ).toEqual({
      ok: true,
      output:
        'note: due read as 2026-11-13\nopened loop-risentire-alice: Risentire Alice (commit 1a2b3c4)',
      commit: '1a2b3c4',
    })
  })

  it('relays the kit refusal in its own words', () => {
    expect(
      brainResult({
        code: 2,
        stdout: '',
        stderr: 'error: refused: looks like a secret (API key); secrets are never stored\n',
        timedOut: false,
      }),
    ).toEqual({
      ok: false,
      error: 'refused: looks like a secret (API key); secrets are never stored',
    })
    expect(brainResult({ code: 1, stdout: '', stderr: '', timedOut: false })).toEqual({
      ok: false,
      error: 'The memory script exited with code 1.',
    })
    expect(brainResult({ code: null, stdout: '', stderr: '', timedOut: true }).ok).toBe(false)
  })

  it('names a crash by its error, not the Node version that closes the stack', () => {
    const stderr =
      "node:fs:440\n  return binding.readFileUtf8(path)\n\nError: ENOENT: no such file, open 'System/memory/loops.md'\n    at loopOpen (brain.mjs:450:42)\n\nNode.js v22.23.4\n"
    expect(brainResult({ code: 1, stdout: '', stderr, timedOut: false })).toEqual({
      ok: false,
      error: "Error: ENOENT: no such file, open 'System/memory/loops.md'",
    })
  })
})

describe('runBrainCommand', () => {
  it('runs the vault script with the built argv, pinned to the generation', async () => {
    const invoke = vi.fn().mockResolvedValue({
      code: 0,
      stdout: 'stored fact: x -> CRM/People/A.md',
      stderr: '',
      timedOut: false,
    })
    setBridge({ invoke, listen: async () => () => {} })
    const result = await runBrainCommand(
      CONFIG,
      { kind: 'remember', memory: 'fact', text: 'x', source: 'chat' },
      { agent: 'kore' },
      7,
    )
    expect(result).toEqual({ ok: true, output: 'stored fact: x -> CRM/People/A.md', commit: null })
    expect(invoke).toHaveBeenCalledWith('kit_script_run', {
      script: 'System/scripts/brain.mjs',
      args: ['remember', '--agent=kore', '--kind=fact', '--text=x', '--source=chat'],
      generation: 7,
    })
  })

  it('turns a missing Node into a message, not a throw', async () => {
    setBridge({
      invoke: vi.fn().mockRejectedValue({
        kind: 'io',
        message: 'Node.js was not found: install Node 18 or newer to write memory',
      }),
      listen: async () => () => {},
    })
    expect(await runBrainCommand(CONFIG, { kind: 'check' }, { agent: 'kore' }, 1)).toEqual({
      ok: false,
      error: 'Node.js was not found: install Node 18 or newer to write memory',
    })
  })
})
