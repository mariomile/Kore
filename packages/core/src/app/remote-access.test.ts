import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import {
  REMOTE_ACCESS_AGENTS_SECRET,
  REMOTE_ACCESS_TOKEN_SECRET,
  addRemoteAgent,
  parseFunnelRun,
  parseTailscaleStatus,
  remoteAccessSetupPrompt,
  remoteAgents,
  removeRemoteAgent,
  setRemoteAgentAccess,
  startRemoteAccess,
  stopRemoteAccess,
} from './remote-access'

afterEach(() => setBridge(null))

const running = {
  running: true,
  port: 8765,
  graphRoot: '/vault',
  readOnly: true,
  exitMessage: null,
}

function tailscaleRun(overrides: Record<string, unknown>) {
  return { found: true, code: 0, stdout: '', stderr: '', timedOut: false, ...overrides }
}

const online = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'mac.tail1.ts.net.' } })

/** A fake bridge answering each command from `answers`, recording every call. */
function installBridge(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const secrets = new Map<string, string>()
  setBridge({
    invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args })
      if (command === 'secret_get') {
        return secrets.get(args.name as string) ?? null
      }
      if (command === 'secret_set') {
        secrets.set(args.name as string, args.value as string)
        return null
      }
      const answer = answers[command]
      if (answer === undefined) {
        throw new Error(`unexpected command ${command}`)
      }
      return answer(args)
    }),
    listen: async () => () => {},
  })
  return { calls, secrets }
}

describe('parseTailscaleStatus', () => {
  it('reads the MagicDNS name without its trailing dot', () => {
    expect(parseTailscaleStatus(online)).toEqual({ kind: 'online', dnsName: 'mac.tail1.ts.net' })
  })

  it('reports a stopped or signed-out client and garbage as offline', () => {
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'Stopped' })).kind).toBe('offline')
    expect(parseTailscaleStatus('not json').kind).toBe('offline')
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: {} })).kind).toBe(
      'offline',
    )
  })
})

describe('parseFunnelRun', () => {
  it('a clean exit is on', () => {
    expect(parseFunnelRun({ code: 0, stdout: 'Available on the internet:\n', stderr: '' })).toEqual(
      { kind: 'on' },
    )
  })

  it('finds the enable link even when the run was cut off waiting for it', () => {
    const stdout =
      'Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n   https://login.tailscale.com/f/funnel?node=n123\n'
    expect(parseFunnelRun({ code: null, stdout, stderr: '' })).toEqual({
      kind: 'needs-enable',
      enableUrl: 'https://login.tailscale.com/f/funnel?node=n123',
    })
  })

  it('a failure carries the first line the CLI printed', () => {
    expect(parseFunnelRun({ code: 1, stdout: '', stderr: '\nfunnel: port busy\nmore' })).toEqual({
      kind: 'error',
      message: 'funnel: port busy',
    })
  })
})

describe('startRemoteAccess', () => {
  it('creates a keychain token, starts the server with the public origin, then publishes it', async () => {
    const { calls, secrets } = installBridge({
      tailscale_run: (args) =>
        tailscaleRun((args.args as string[])[0] === 'status' ? { stdout: online } : {}),
      remote_mcp_start: () => running,
    })

    const state = await startRemoteAccess({ generation: 3, readOnly: true })

    const token = secrets.get(REMOTE_ACCESS_TOKEN_SECRET)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.map((entry) => entry.command)).toEqual([
      'secret_get',
      'secret_set',
      'secret_get',
      'tailscale_run',
      'remote_mcp_start',
      'tailscale_run',
    ])
    expect(calls[4]?.args).toEqual({
      generation: 3,
      port: 8765,
      token,
      agents: '[]',
      readOnly: true,
      publicUrl: 'https://mac.tail1.ts.net',
    })
    expect(calls[5]?.args).toEqual({ args: ['funnel', '--bg', '8765'] })
    expect(state).toEqual({
      server: running,
      localUrl: 'http://127.0.0.1:8765/mcp',
      publicUrl: 'https://mac.tail1.ts.net/mcp',
      tunnel: { kind: 'on' },
    })
  })

  it('reuses the stored token', async () => {
    const { calls, secrets } = installBridge({
      tailscale_run: () => tailscaleRun({ stdout: online }),
      remote_mcp_start: () => running,
    })
    secrets.set(REMOTE_ACCESS_TOKEN_SECRET, 'a'.repeat(64))
    await startRemoteAccess({ generation: 1, readOnly: false })
    expect(calls.some((entry) => entry.command === 'secret_set')).toBe(false)
    expect(calls.find((entry) => entry.command === 'remote_mcp_start')?.args.token).toBe(
      'a'.repeat(64),
    )
  })

  it('without Tailscale the server still runs locally and nothing is published', async () => {
    const { calls } = installBridge({
      tailscale_run: () => tailscaleRun({ found: false, code: null }),
      remote_mcp_start: () => running,
    })
    const state = await startRemoteAccess({ generation: 1, readOnly: true })
    expect(state.tunnel).toEqual({ kind: 'no-tailscale' })
    expect(state.publicUrl).toBeNull()
    expect(calls.filter((entry) => entry.command === 'tailscale_run')).toHaveLength(1)
    expect(calls.find((entry) => entry.command === 'remote_mcp_start')?.args.publicUrl).toBeNull()
  })
})

describe('remote agents', () => {
  it('each agent gets its own key and access, handed to the server', async () => {
    const { calls, secrets } = installBridge({
      tailscale_run: () => tailscaleRun({ found: false, code: null }),
      remote_mcp_start: () => running,
    })
    const grok = await addRemoteAgent(' Grok bot ', 'read')
    const chatgpt = await addRemoteAgent('ChatGPT', 'write')
    expect(grok).toMatchObject({ name: 'Grok bot', access: 'read' })
    expect(grok.key).not.toBe(chatgpt.key)
    await expect(addRemoteAgent('grok BOT', 'write')).rejects.toThrow('already has a key')

    await removeRemoteAgent(grok.id)
    expect((await remoteAgents()).map((agent) => agent.name)).toEqual(['ChatGPT'])

    await startRemoteAccess({ generation: 1, readOnly: false })
    const started = calls.find((entry) => entry.command === 'remote_mcp_start')
    expect(JSON.parse(started?.args.agents as string)).toEqual([chatgpt])

    secrets.set(REMOTE_ACCESS_AGENTS_SECRET, 'not json')
    expect(await remoteAgents()).toEqual([])
  })

  it('changes an agent to propose without a new key, and reads keys saved before', async () => {
    const { secrets } = installBridge({})
    const key = 'k'.repeat(32)
    secrets.set(
      REMOTE_ACCESS_AGENTS_SECRET,
      JSON.stringify([
        { id: 'a', name: 'Old writer', key, write: true },
        { id: 'b', name: 'Old reader', key, write: false },
      ]),
    )
    expect((await remoteAgents()).map((agent) => agent.access)).toEqual(['write', 'read'])

    await setRemoteAgentAccess('a', 'propose')
    const stored: unknown = JSON.parse(secrets.get(REMOTE_ACCESS_AGENTS_SECRET) ?? '')
    expect(stored).toEqual([
      { id: 'a', name: 'Old writer', key, access: 'propose' },
      { id: 'b', name: 'Old reader', key, access: 'read' },
    ])
  })

  it('the setup prompt points at the public setup page, never the key', () => {
    expect(remoteAccessSetupPrompt('https://mac.tail1.ts.net/mcp')).toBe(
      'Read https://mac.tail1.ts.net/setup.md and connect to my Kore vault. Ask me for the key when you need it.',
    )
  })
})

describe('stopRemoteAccess', () => {
  it('unpublishes, then stops the server, even when Tailscale fails', async () => {
    const { calls } = installBridge({
      tailscale_run: () => {
        throw new Error('boom')
      },
      remote_mcp_stop: () => ({ ...running, running: false, port: null, graphRoot: null }),
    })
    await stopRemoteAccess()
    expect(calls.map((entry) => entry.command)).toEqual(['tailscale_run', 'remote_mcp_stop'])
    expect(calls[0]?.args).toEqual({ args: ['funnel', '--bg', '8765', 'off'] })
  })
})
