import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import {
  CLAUDE_MISSING_MESSAGE,
  CLAUDE_SIGNED_OUT_MESSAGE,
  claudeCliErrorMessage,
  claudeLoginStatus,
  runClaudeLogin,
} from './claude-auth'

afterEach(() => {
  setBridge(null)
})

/** A bridge whose `agent_cli_run` replays `lines` and exits with `code`. */
function installCli(lines: string[], code: number): Record<string, unknown>[] {
  const runs: Record<string, unknown>[] = []
  let emit: ((payload: unknown) => void) | null = null
  setBridge({
    invoke: async (command, args) => {
      if (command === 'agent_cli_run') {
        runs.push(args)
        const requestId = String(args['requestId'])
        queueMicrotask(() => {
          for (const line of lines) {
            emit?.({ kind: 'line', requestId, line })
          }
          emit?.({ kind: 'done', requestId, code })
        })
      }
      return null
    },
    listen: async (_event, handler) => {
      emit = handler
      return () => {
        emit = null
      }
    },
  })
  return runs
}

describe('claudeLoginStatus', () => {
  it('reads the account and plan from `claude auth status --json`', async () => {
    const runs = installCli(
      [
        '{',
        '  "loggedIn": true,',
        '  "authMethod": "claude.ai",',
        '  "email": "mario@example.com",',
        '  "subscriptionType": "max"',
        '}',
      ],
      0,
    )
    await expect(claudeLoginStatus()).resolves.toEqual({
      loggedIn: true,
      detail: 'Signed in as mario@example.com · Claude Max',
    })
    expect(runs[0]).toMatchObject({ binary: 'claude', args: ['auth', 'status', '--json'] })
  })

  it('reports signed out on a logged-out status', async () => {
    installCli(['{ "loggedIn": false, "authMethod": "none" }'], 1)
    await expect(claudeLoginStatus()).resolves.toEqual({
      loggedIn: false,
      detail: 'Not signed in',
    })
  })
})

describe('runClaudeLogin', () => {
  it('relays the printed sign-in URL and resolves on the exit code', async () => {
    const runs = installCli(
      [
        'Opening browser to sign in…',
        'If the browser didn’t open, visit:',
        'https://claude.ai/oauth/authorize?code=true&client_id=abc',
        'Login successful.',
      ],
      0,
    )
    const urls: string[] = []
    await expect(
      runClaudeLogin({
        onAuthUrl: (url) => {
          urls.push(url)
        },
      }),
    ).resolves.toEqual({
      success: true,
      message: null,
    })
    expect(urls).toEqual(['https://claude.ai/oauth/authorize?code=true&client_id=abc'])
    expect(runs[0]).toMatchObject({ args: ['auth', 'login', '--claudeai'] })
  })
})

describe('claudeCliErrorMessage', () => {
  it('turns the CLI’s /login errors and a missing binary into app guidance', () => {
    expect(claudeCliErrorMessage('Not logged in · Please run /login')).toBe(
      CLAUDE_SIGNED_OUT_MESSAGE,
    )
    expect(claudeCliErrorMessage('Login expired · Please run /login')).toBe(
      CLAUDE_SIGNED_OUT_MESSAGE,
    )
    expect(claudeCliErrorMessage('Claude Code CLI (`claude`) was not found')).toBe(
      CLAUDE_MISSING_MESSAGE,
    )
    expect(claudeCliErrorMessage('Overloaded')).toBe('Overloaded')
  })
})
