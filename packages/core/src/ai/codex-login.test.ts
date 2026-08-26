import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { agentCliFailureMessage, isAgentCliRuntimeFailure } from './agent-cli-failure'
import { runAgentCliCommand } from './agent-cli'
import { codexLoginStatus, runCodexLogin } from './codex-cli'

afterEach(() => {
  setBridge(null)
})

interface FakeCli {
  runs: Record<string, unknown>[]
  stops: string[]
  emit: ((payload: unknown) => void) | null
}

function installFakeCli(): FakeCli {
  const fake: FakeCli = { runs: [], stops: [], emit: null }
  setBridge({
    invoke: async (command, args) => {
      if (command === 'agent_cli_run') {
        fake.runs.push(args)
        return null
      }
      if (command === 'agent_cli_stop') {
        fake.stops.push(String(args['requestId']))
        return null
      }
      return null
    },
    listen: async (_event, handler) => {
      fake.emit = handler
      return () => {
        fake.emit = null
      }
    },
  })
  return fake
}

function requestIdOf(fake: FakeCli): string {
  return String(fake.runs[0]?.['requestId'])
}

describe('runAgentCliCommand', () => {
  it('collects lines (stderr included via streamStderr) and the exit code', async () => {
    const fake = installFakeCli()
    const seen: string[] = []
    const pending = runAgentCliCommand({
      binary: 'codex',
      args: ['login', 'status'],
      onLine: (line) => {
        seen.push(line)
      },
    })
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    expect(fake.runs[0]).toMatchObject({ args: ['login', 'status'], streamStderr: true })
    fake.emit?.({ kind: 'line', requestId, line: 'Not logged in' })
    fake.emit?.({ kind: 'done', requestId, code: 1 })

    await expect(pending).resolves.toEqual({
      code: 1,
      lines: ['Not logged in'],
      failure: null,
    })
    expect(seen).toEqual(['Not logged in'])
  })

  it('kills the child when the signal aborts', async () => {
    const fake = installFakeCli()
    const controller = new AbortController()
    const pending = runAgentCliCommand({
      binary: 'codex',
      args: ['login'],
      signal: controller.signal,
    })
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    controller.abort()
    expect(fake.stops).toEqual([requestId])
    fake.emit?.({ kind: 'done', requestId, code: null })
    await expect(pending).resolves.toMatchObject({ code: null })
  })
})

describe('codexLoginStatus', () => {
  it('maps exit code zero to logged in with the CLI detail line', async () => {
    const fake = installFakeCli()
    const pending = codexLoginStatus()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({ kind: 'line', requestId, line: 'Logged in using ChatGPT' })
    fake.emit?.({ kind: 'done', requestId, code: 0 })
    await expect(pending).resolves.toEqual({
      loggedIn: true,
      detail: 'Logged in using ChatGPT',
    })
  })

  it('treats a missing Node interpreter as a CLI failure, not signed-out', async () => {
    const fake = installFakeCli()
    const pending = codexLoginStatus()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({
      kind: 'failed',
      requestId,
      message: 'env: node: No such file or directory',
    })
    fake.emit?.({ kind: 'done', requestId, code: 127 })
    await expect(pending).rejects.toThrow('The CLI needs Node.js on your PATH')
  })
})

describe('runCodexLogin', () => {
  it('relays the printed OAuth URL once and resolves on the exit code', async () => {
    const fake = installFakeCli()
    const urls: string[] = []
    const pending = runCodexLogin({
      onAuthUrl: (url) => {
        urls.push(url)
      },
    })
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({
      kind: 'line',
      requestId,
      line: 'Starting local login server on http://localhost:1455.',
    })
    fake.emit?.({
      kind: 'line',
      requestId,
      line: 'https://auth.openai.com/oauth/authorize?code_challenge=abc',
    })
    fake.emit?.({ kind: 'line', requestId, line: 'https://auth.openai.com/second-url-ignored' })
    fake.emit?.({ kind: 'done', requestId, code: 0 })

    await expect(pending).resolves.toEqual({ success: true, message: null })
    // The localhost line never opens; only the first auth URL does.
    expect(urls).toEqual(['https://auth.openai.com/oauth/authorize?code_challenge=abc'])
  })

  it('surfaces a failed flow with the CLI last line', async () => {
    const fake = installFakeCli()
    const pending = runCodexLogin({ onAuthUrl: () => {} })
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({ kind: 'line', requestId, line: 'login failed: port busy' })
    fake.emit?.({ kind: 'done', requestId, code: 1 })
    await expect(pending).resolves.toEqual({ success: false, message: 'login failed: port busy' })
  })

  it('rewrites a missing Node interpreter into an actionable message', async () => {
    const fake = installFakeCli()
    const pending = runCodexLogin({ onAuthUrl: () => {} })
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({
      kind: 'failed',
      requestId,
      message: 'env: node: No such file or directory',
    })
    fake.emit?.({ kind: 'done', requestId, code: 127 })
    await expect(pending).resolves.toEqual({
      success: false,
      message: 'The CLI needs Node.js on your PATH. Install Node and retry.',
    })
  })
})

describe('agent CLI runtime failures', () => {
  it('detects POSIX 127 and env-interpreter stderr', () => {
    expect(
      isAgentCliRuntimeFailure({
        code: 1,
        lines: ['Not logged in'],
        failure: null,
      }),
    ).toBe(false)
    expect(
      isAgentCliRuntimeFailure({
        code: 127,
        lines: [],
        failure: 'env: node: No such file or directory',
      }),
    ).toBe(true)
    expect(
      isAgentCliRuntimeFailure({
        code: 1,
        lines: ['env: node: No such file or directory'],
        failure: null,
      }),
    ).toBe(true)
  })

  it('humanizes a missing Node interpreter', () => {
    expect(
      agentCliFailureMessage({
        code: 127,
        lines: [],
        failure: 'env: node: No such file or directory',
      }),
    ).toBe('The CLI needs Node.js on your PATH. Install Node and retry.')
    expect(
      agentCliFailureMessage({
        code: 1,
        lines: ['login failed: port busy'],
        failure: null,
      }),
    ).toBe('login failed: port busy')
  })
})
