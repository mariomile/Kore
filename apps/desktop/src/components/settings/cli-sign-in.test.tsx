import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { CliSignIn } from './cli-sign-in'
import type { CliSignInFlow } from './cli-sign-in-flows'

const openUrlSync = vi.hoisted(() => vi.fn())
vi.mock('@/lib/open-url', () => ({ openUrlSync }))

type LoginOutcome = Awaited<ReturnType<CliSignInFlow['login']>>

function fakeFlow(overrides: Partial<CliSignInFlow>): CliSignInFlow {
  return {
    queryKey: ['fake-auth-status', crypto.randomUUID()],
    cliName: 'Codex',
    accountName: 'ChatGPT',
    installCommand: 'npm install -g @openai/codex',
    cliOpensBrowser: false,
    status: async () => ({ loggedIn: false, detail: 'Not logged in' }),
    login: async () => ({ success: true, message: null }),
    logout: async () => {},
    ...overrides,
  }
}

function renderSignIn(flow: CliSignInFlow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CliSignIn flow={flow} />
    </QueryClientProvider>,
  )
}

describe('CliSignIn', () => {
  it('shows the signed-in state with the CLI detail and a sign-out', async () => {
    const view = await renderSignIn(
      fakeFlow({ status: async () => ({ loggedIn: true, detail: 'Logged in using ChatGPT' }) }),
    )
    await expect.element(view.getByText('Logged in using ChatGPT')).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await view.unmount()
  })

  it('runs the sign-in flow: opens the auth URL, then re-checks the status', async () => {
    openUrlSync.mockClear()
    let loggedIn = false
    let resolveFlow: (outcome: LoginOutcome) => void = () => {}
    const flow = fakeFlow({
      status: async () =>
        loggedIn
          ? { loggedIn: true, detail: 'Logged in using ChatGPT' }
          : { loggedIn: false, detail: 'Not logged in' },
      login: ({ onAuthUrl }) => {
        onAuthUrl('https://auth.openai.com/oauth/authorize?x=1')
        return new Promise((resolve) => {
          resolveFlow = resolve
        })
      },
    })

    const view = await renderSignIn(flow)
    await view.getByRole('button', { name: 'Sign in with ChatGPT' }).click()
    expect(openUrlSync).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?x=1')
    await expect.element(view.getByText(/Finish signing in/)).toBeVisible()

    loggedIn = true
    resolveFlow({ success: true, message: null })
    await expect.element(view.getByText('Logged in using ChatGPT')).toBeVisible()
    await view.unmount()
  })

  it('leaves the browser to a CLI that opens it, keeping the URL as a fallback', async () => {
    openUrlSync.mockClear()
    const view = await renderSignIn(
      fakeFlow({
        cliName: 'Claude Code',
        accountName: 'Claude',
        cliOpensBrowser: true,
        login: ({ onAuthUrl }) => {
          onAuthUrl('https://claude.ai/oauth/authorize?x=1')
          return new Promise(() => {})
        },
      }),
    )
    await view.getByRole('button', { name: 'Sign in with Claude' }).click()
    await expect.element(view.getByText(/Finish signing in with Claude/)).toBeVisible()
    expect(openUrlSync).not.toHaveBeenCalled()
    await view.getByRole('button', { name: 'Open page' }).click()
    expect(openUrlSync).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?x=1')
    await view.unmount()
  })

  it('surfaces a failed flow', async () => {
    const view = await renderSignIn(
      fakeFlow({ login: async () => ({ success: false, message: 'port busy' }) }),
    )
    await view.getByRole('button', { name: 'Sign in with ChatGPT' }).click()
    await expect.element(view.getByRole('alert')).toHaveTextContent('port busy')
    await view.unmount()
  })

  it('points to the install command when the CLI is missing', async () => {
    const view = await renderSignIn(
      fakeFlow({
        status: async () => {
          throw new Error('Codex CLI (`codex`) was not found')
        },
      }),
    )
    await expect.element(view.getByText(/Codex isn’t installed/)).toBeVisible()
    await expect.element(view.getByText('npm install -g @openai/codex')).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Check again' })).toBeVisible()
    await view.unmount()
  })
})
