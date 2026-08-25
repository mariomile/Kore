import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderHook } from 'vitest-browser-react'
import { resetMacosFullscreenStore } from './macos-fullscreen-store'
import { useMacosTrafficLightInset } from './use-macos-traffic-light-inset'

const windowMock = vi.hoisted(() => ({
  fullscreen: false,
  isFullscreen: vi.fn(async () => windowMock.fullscreen),
}))

vi.mock('@/lib/window-chrome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/window-chrome')>()
  return {
    ...actual,
    hasMacosTitleBarOverlay: true,
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: windowMock.isFullscreen,
  }),
}))

async function renderInset() {
  return await renderHook(() => useMacosTrafficLightInset())
}

beforeEach(() => {
  windowMock.fullscreen = false
  windowMock.isFullscreen.mockClear()
  windowMock.isFullscreen.mockImplementation(async () => windowMock.fullscreen)
})

afterEach(() => {
  windowMock.fullscreen = false
  resetMacosFullscreenStore()
})

describe('useMacosTrafficLightInset', () => {
  it('indents while the overlay lights are visible', async () => {
    const { result, unmount } = await renderInset()
    expect(result.current).toBe(true)
    await vi.waitFor(() => {
      expect(windowMock.isFullscreen).toHaveBeenCalled()
    })
    expect(result.current).toBe(true)
    await unmount()
  })

  it('drops the inset once the window is fullscreen', async () => {
    windowMock.fullscreen = true
    const { result, unmount } = await renderInset()
    await vi.waitFor(() => {
      expect(result.current).toBe(false)
    })
    expect(windowMock.isFullscreen).toHaveBeenCalled()
    await unmount()
  })

  it('drops the inset when a resize reports fullscreen', async () => {
    const { result, unmount } = await renderInset()
    await vi.waitFor(() => {
      expect(windowMock.isFullscreen).toHaveBeenCalled()
    })
    expect(result.current).toBe(true)

    windowMock.fullscreen = true
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    await vi.waitFor(() => {
      expect(result.current).toBe(false)
    })
    await unmount()
  })

  it('restores the inset when leaving fullscreen', async () => {
    windowMock.fullscreen = true
    const { result, unmount } = await renderInset()
    await vi.waitFor(() => {
      expect(result.current).toBe(false)
    })

    windowMock.fullscreen = false
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    await vi.waitFor(() => {
      expect(result.current).toBe(true)
    })
    await unmount()
  })

  it('mounted hooks share one native reader', async () => {
    const first = await renderInset()
    const second = await renderInset()
    await vi.waitFor(() => {
      expect(windowMock.isFullscreen).toHaveBeenCalled()
    })
    const calls = windowMock.isFullscreen.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    await vi.waitFor(() => {
      expect(windowMock.isFullscreen.mock.calls.length).toBeGreaterThan(calls)
    })
    // One resize → one read, not one per mounted hook.
    expect(windowMock.isFullscreen.mock.calls.length - calls).toBe(1)
    await first.unmount()
    await second.unmount()
  })
})
