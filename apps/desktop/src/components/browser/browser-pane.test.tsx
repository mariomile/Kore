import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserSessionForTests, setBrowserSessionUrl } from '@/lib/browser-session'

interface EmbedRect {
  x: number
  y: number
  width: number
  height: number
}

const browserEmbedShow = vi.hoisted(() =>
  vi.fn<(url: string | null, rect: EmbedRect) => Promise<void>>(),
)
const browserEmbedBounds = vi.hoisted(() => vi.fn<() => Promise<void>>())
const browserEmbedHide = vi.hoisted(() => vi.fn<() => Promise<void>>())
const browserEmbedNavigate = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>())
const browserEmbedBack = vi.hoisted(() => vi.fn<() => Promise<void>>())
const browserEmbedForward = vi.hoisted(() => vi.fn<() => Promise<void>>())
const browserEmbedReload = vi.hoisted(() => vi.fn<() => Promise<void>>())
const subscribeBrowserNavigated = vi.hoisted(() => vi.fn(async () => () => {}))
const isNativeShell = vi.hoisted(() => vi.fn(() => true))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  browserEmbedShow,
  browserEmbedBounds,
  browserEmbedHide,
  browserEmbedNavigate,
  browserEmbedBack,
  browserEmbedForward,
  browserEmbedReload,
  subscribeBrowserNavigated,
}))
vi.mock('@/lib/platform', () => ({
  isNativeShell,
}))

const { BrowserPane, normalizeAddress } = await import('./browser-pane')

beforeEach(() => {
  vi.clearAllMocks()
  isNativeShell.mockReturnValue(true)
  browserEmbedShow.mockResolvedValue(undefined)
  browserEmbedBounds.mockResolvedValue(undefined)
  browserEmbedNavigate.mockResolvedValue(undefined)
  browserEmbedHide.mockResolvedValue(undefined)
  browserEmbedBack.mockResolvedValue(undefined)
  browserEmbedForward.mockResolvedValue(undefined)
  browserEmbedReload.mockResolvedValue(undefined)
})

afterEach(() => {
  resetBrowserSessionForTests()
  cleanup()
})

describe('BrowserPane', () => {
  it('docks the embedded webview over its host on mount and hides it on unmount', async () => {
    const view = await render(<BrowserPane />)

    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalled())
    const [url, rect] = browserEmbedShow.mock.calls[0]!
    expect(url).toBe('https://duckduckgo.com/')
    expect(rect.width).toBeGreaterThan(0)

    await view.unmount()
    await vi.waitFor(() => expect(browserEmbedHide).toHaveBeenCalled())
  })

  it('resumes the session page instead of the default one', async () => {
    setBrowserSessionUrl('https://example.com/docs')
    const view = await render(<BrowserPane />)
    await vi.waitFor(() =>
      expect(browserEmbedShow.mock.calls[0]?.[0]).toBe('https://example.com/docs'),
    )
    await view.unmount()
  })

  it('navigates from the address bar, completing bare domains to https', async () => {
    const view = await render(<BrowserPane />)
    const address = view.getByRole('textbox', { name: 'Address' })
    await address.fill('example.com/path')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(browserEmbedNavigate).toHaveBeenCalledWith('https://example.com/path'),
    )
    await view.unmount()
  })

  it('drives history and reload through the shell', async () => {
    const view = await render(<BrowserPane />)
    await view.getByRole('button', { name: 'Back' }).click()
    await view.getByRole('button', { name: 'Forward' }).click()
    await view.getByRole('button', { name: 'Reload' }).click()
    expect(browserEmbedBack).toHaveBeenCalled()
    expect(browserEmbedForward).toHaveBeenCalled()
    expect(browserEmbedReload).toHaveBeenCalled()
    await view.unmount()
  })

  it('is honest outside the native shell', async () => {
    isNativeShell.mockReturnValue(false)
    const view = await render(<BrowserPane />)
    await expect
      .element(view.getByText('The built-in browser is available in the desktop app.'))
      .toBeVisible()
    expect(browserEmbedShow).not.toHaveBeenCalled()
    await view.unmount()
  })
})

describe('normalizeAddress', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com'],
    ['example.com', 'https://example.com'],
    ['docs.rs/tauri', 'https://docs.rs/tauri'],
    ['rust child webview', 'https://duckduckgo.com/?q=rust%20child%20webview'],
    ['hello', 'https://duckduckgo.com/?q=hello'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeAddress(raw)).toBe(expected)
  })

  it('refuses empty input and non-web schemes', () => {
    expect(normalizeAddress('   ')).toBeNull()
    expect(normalizeAddress('file:///etc/passwd')).toBeNull()
    expect(normalizeAddress('javascript:alert(1)')).toBeNull()
  })
})
