import { act } from 'react'
import { cleanup, renderHook } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkClickHandler } from '@meowdown/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { dispatchDeepLink } from '@/lib/deep-links/intake'
import { useOpenExternalLink, preferOsBrowser } from '@/editor/open-external-link'

const openDeepLinkInNewWindow = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
const openBrowserWindow = vi.hoisted(() => vi.fn<() => Promise<void>>())
const settingsState = vi.hoisted(() => ({
  browserOpenLinksInApp: true,
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => {}),
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  openBrowserWindow,
}))

vi.mock('@/lib/deep-links/intake', () => ({
  dispatchDeepLink: vi.fn(),
}))
vi.mock('@/lib/windows/open-in-new-window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/windows/open-in-new-window')>()),
  openDeepLinkInNewWindow,
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: settingsState,
    updateSettings: () => {},
  }),
}))

let openExternalLink: LinkClickHandler

function click(href: string, metaKey = false, altKey = false): MouseEvent {
  const event = new MouseEvent('click', { cancelable: true, metaKey, altKey })
  act(() => openExternalLink({ href, event, mod: metaKey }))
  return event
}

beforeEach(async () => {
  vi.clearAllMocks()
  settingsState.browserOpenLinksInApp = true
  openDeepLinkInNewWindow.mockResolvedValue(true)
  openBrowserWindow.mockResolvedValue(undefined)
  const { result } = await renderHook(() => useOpenExternalLink())
  openExternalLink = result.current
})

afterEach(cleanup)

describe('preferOsBrowser', () => {
  it('uses Alt as the OS-browser hatch when links open in-app', () => {
    expect(preferOsBrowser(false, true)).toBe(false)
    expect(preferOsBrowser(true, true)).toBe(true)
  })

  it('inverts Alt when links open in the OS browser', () => {
    expect(preferOsBrowser(false, false)).toBe(true)
    expect(preferOsBrowser(true, false)).toBe(false)
  })
})

describe('openExternalLink', () => {
  it('opens an http(s) link in the in-app browser window and blocks the frame navigation', async () => {
    const event = click('https://example.com')

    expect(openBrowserWindow).toHaveBeenCalledWith('https://example.com')
    expect(openUrl).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('⌘-click also opens the in-app browser — in the editor it IS the open gesture', async () => {
    click('https://example.com', true)

    expect(openBrowserWindow).toHaveBeenCalledWith('https://example.com')
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('Alt-click is the OS-browser escape hatch', async () => {
    click('https://example.com', false, true)

    expect(openUrl).toHaveBeenCalledWith('https://example.com')
    expect(openBrowserWindow).not.toHaveBeenCalled()
  })

  it('opens web links in the OS browser when the in-app setting is off', async () => {
    settingsState.browserOpenLinksInApp = false
    const { result } = await renderHook(() => useOpenExternalLink())
    openExternalLink = result.current
    click('https://example.com')

    expect(openUrl).toHaveBeenCalledWith('https://example.com')
    expect(openBrowserWindow).not.toHaveBeenCalled()
  })

  it('Alt-click uses the in-app browser when the setting prefers the OS', async () => {
    settingsState.browserOpenLinksInApp = false
    const { result } = await renderHook(() => useOpenExternalLink())
    openExternalLink = result.current
    click('https://example.com', false, true)

    expect(openBrowserWindow).toHaveBeenCalledWith('https://example.com')
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('falls back to the OS browser when the in-app window cannot open', async () => {
    // The fallback logs the shell failure it is recovering from.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    openBrowserWindow.mockRejectedValue(new Error('no window for you'))
    click('https://example.com')

    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://example.com'))
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('routes a reflect:// link through the in-app deep-link intake, not the URL opener', async () => {
    click('reflect://note/abc123')

    expect(dispatchDeepLink).toHaveBeenCalledWith('reflect://note/abc123')
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('⌘-clicks a rendered reflect:// link into a secondary window', async () => {
    click('reflect://note/abc123', true)

    await vi.waitFor(() =>
      expect(openDeepLinkInNewWindow).toHaveBeenCalledWith('reflect://note/abc123'),
    )
    expect(dispatchDeepLink).not.toHaveBeenCalled()
  })

  it('falls back to in-window dispatch when a rendered deep link cannot open a window', async () => {
    openDeepLinkInNewWindow.mockResolvedValue(false)
    click('reflect://note/abc123', true)

    await vi.waitFor(() => expect(dispatchDeepLink).toHaveBeenCalledWith('reflect://note/abc123'))
  })

  it('opens a custom app scheme in its OS default app', async () => {
    const event = click('x-devonthink-item://40C88434-68B6-4DCB-A258-754679764C3C')

    expect(openUrl).toHaveBeenCalledWith('x-devonthink-item://40C88434-68B6-4DCB-A258-754679764C3C')
    expect(event.defaultPrevented).toBe(true)
  })

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
    ['blob:https://example.com/uuid'],
  ])('drops the unsafe scheme %s without opening anything', (href) => {
    const event = click(href)

    expect(openUrl).not.toHaveBeenCalled()
    expect(dispatchDeepLink).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('drops a scheme-less relative href', async () => {
    const event = click('notes/foo.md')

    expect(openUrl).not.toHaveBeenCalled()
    expect(dispatchDeepLink).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })
})
