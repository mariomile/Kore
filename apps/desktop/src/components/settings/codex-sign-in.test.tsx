import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

const codexLoginStatus = vi.hoisted(() => vi.fn())
const runCodexLogin = vi.hoisted(() =>
  vi.fn<(options: { onAuthUrl: (url: string) => void }) => Promise<unknown>>(),
)
const codexLogout = vi.hoisted(() => vi.fn(async () => {}))
const openUrlSync = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  codexLoginStatus,
  runCodexLogin,
  codexLogout,
}))
vi.mock('@/lib/open-url', () => ({ openUrlSync }))

const { CodexSignIn } = await import('./codex-sign-in')

function renderSignIn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CodexSignIn />
    </QueryClientProvider>,
  )
}

describe('CodexSignIn', () => {
  it('shows the signed-in state with the CLI detail and a sign-out', async () => {
    codexLoginStatus.mockResolvedValue({ loggedIn: true, detail: 'Logged in using ChatGPT' })
    const view = await renderSignIn()
    await expect.element(view.getByText('Logged in using ChatGPT')).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await view.unmount()
  })

  it('runs the sign-in flow: opens the auth URL, then re-checks the status', async () => {
    codexLoginStatus.mockResolvedValue({ loggedIn: false, detail: 'Not logged in' })
    let resolveFlow: (outcome: { success: boolean; message: string | null }) => void = () => {}
    runCodexLogin.mockImplementation(({ onAuthUrl }) => {
      onAuthUrl('https://auth.openai.com/oauth/authorize?x=1')
      return new Promise((resolve) => {
        resolveFlow = resolve as typeof resolveFlow
      })
    })

    const view = await renderSignIn()
    await view.getByRole('button', { name: 'Sign in with ChatGPT' }).click()
    // The URL opens in the OS browser and the pending state shows.
    expect(openUrlSync).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?x=1')
    await expect.element(view.getByText(/Finish signing in/)).toBeVisible()

    codexLoginStatus.mockResolvedValue({ loggedIn: true, detail: 'Logged in using ChatGPT' })
    resolveFlow({ success: true, message: null })
    await expect.element(view.getByText('Logged in using ChatGPT')).toBeVisible()
    await view.unmount()
  })

  it('surfaces a failed flow', async () => {
    codexLoginStatus.mockResolvedValue({ loggedIn: false, detail: 'Not logged in' })
    runCodexLogin.mockResolvedValue({ success: false, message: 'port busy' })
    const view = await renderSignIn()
    await view.getByRole('button', { name: 'Sign in with ChatGPT' }).click()
    await expect.element(view.getByRole('alert')).toHaveTextContent('port busy')
    await view.unmount()
  })

  it('degrades gracefully when the CLI is missing', async () => {
    codexLoginStatus.mockRejectedValue(new Error('codex was not found'))
    const view = await renderSignIn()
    await expect.element(view.getByText(/Couldn’t check the Codex CLI/)).toBeVisible()
    await view.unmount()
  })

  it('shows why the CLI failed to run', async () => {
    codexLoginStatus.mockRejectedValue(
      new Error('The CLI needs Node.js on your PATH. Install Node and retry.'),
    )
    const view = await renderSignIn()
    await expect.element(view.getByText(/The CLI needs Node.js on your PATH/)).toBeVisible()
    await view.unmount()
  })
})
