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
const browserEmbedClose = vi.hoisted(() => vi.fn<() => Promise<void>>())
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
  browserEmbedClose,
  browserEmbedNavigate,
  browserEmbedBack,
  browserEmbedForward,
  browserEmbedReload,
  subscribeBrowserNavigated,
}))
vi.mock('@/lib/platform', () => ({
  isNativeShell,
}))
const searchEngine = vi.hoisted(() => ({ current: 'duckduckgo' as 'duckduckgo' | 'google' }))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { browserSearchEngine: searchEngine.current, browserOpenLinksInApp: true },
    updateSettings: () => {},
  }),
}))

const { BrowserPane, normalizeAddress } = await import('./browser-pane')

beforeEach(() => {
  vi.clearAllMocks()
  searchEngine.current = 'duckduckgo'
  isNativeShell.mockReturnValue(true)
  browserEmbedShow.mockResolvedValue(undefined)
  browserEmbedBounds.mockResolvedValue(undefined)
  browserEmbedNavigate.mockResolvedValue(undefined)
  browserEmbedClose.mockResolvedValue(undefined)
  browserEmbedBack.mockResolvedValue(undefined)
  browserEmbedForward.mockResolvedValue(undefined)
  browserEmbedReload.mockResolvedValue(undefined)
})

afterEach(() => {
  resetBrowserSessionForTests()
  cleanup()
})

describe('BrowserPane', () => {
  it('docks the embedded webview over its host and closes it after unmount', async () => {
    const view = await render(<BrowserPane />)

    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalled())
    const [url, rect] = browserEmbedShow.mock.calls[0]!
    expect(url).toBe('https://duckduckgo.com/')
    expect(rect.width).toBeGreaterThan(0)

    await view.unmount()
    await vi.waitFor(() => expect(browserEmbedClose).toHaveBeenCalled())
  })

  it('opens a fresh session on the chosen engine, not always DuckDuckGo', async () => {
    searchEngine.current = 'google'
    const view = await render(<BrowserPane />)

    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalled())
    expect(browserEmbedShow.mock.calls[0]![0]).toBe('https://www.google.com/')
    await view.unmount()
  })

  it('keeps the session URL over the home page once the browser has navigated', async () => {
    searchEngine.current = 'google'
    setBrowserSessionUrl('https://example.com/a')
    const view = await render(<BrowserPane />)

    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalled())
    expect(browserEmbedShow.mock.calls[0]![0]).toBe('https://example.com/a')
    await view.unmount()
  })

  it('waits for a pending dock before closing an unmounted host', async () => {
    let releaseShow: () => void = () => {}
    browserEmbedShow.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseShow = resolve
        }),
    )
    const view = await render(<BrowserPane />)
    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalled())

    await view.unmount()
    await Promise.resolve()
    expect(browserEmbedClose).not.toHaveBeenCalled()

    releaseShow()
    await vi.waitFor(() => expect(browserEmbedClose).toHaveBeenCalledOnce())
  })

  it('hands the webview to a surviving pane instead of hiding it under it', async () => {
    const first = await render(<BrowserPane />)
    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalledTimes(1))
    const second = await render(<BrowserPane />)
    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalledTimes(2))

    // The newer owner unmounts while the first pane is still up: the
    // webview re-docks over the survivor, it is not closed.
    await second.unmount()
    await vi.waitFor(() => expect(browserEmbedShow).toHaveBeenCalledTimes(3))
    expect(browserEmbedClose).not.toHaveBeenCalled()

    await first.unmount()
    await vi.waitFor(() => expect(browserEmbedClose).toHaveBeenCalledTimes(1))
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

  it('uses the chosen search engine for free text', () => {
    expect(normalizeAddress('hello', 'google')).toBe('https://www.google.com/search?q=hello')
    expect(normalizeAddress('hello', 'bing')).toBe('https://www.bing.com/search?q=hello')
  })

  it('refuses empty input and non-web schemes', () => {
    expect(normalizeAddress('   ')).toBeNull()
    expect(normalizeAddress('file:///etc/passwd')).toBeNull()
    expect(normalizeAddress('javascript:alert(1)')).toBeNull()
  })
})
