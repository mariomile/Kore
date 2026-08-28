import { afterEach, describe, expect, it } from 'vitest'
import {
  browserSessionUrl,
  openInAppBrowser,
  registerInAppBrowserOpener,
  resetBrowserSessionForTests,
  setBrowserSessionUrl,
  subscribeBrowserSession,
} from './browser-session'

afterEach(resetBrowserSessionForTests)

describe('browser session', () => {
  it('starts with no page of its own and follows navigations', () => {
    // Null, not a URL: the home page follows the browser's search-engine
    // setting, which this module cannot read.
    expect(browserSessionUrl()).toBeNull()
    const seen: string[] = []
    const unsubscribe = subscribeBrowserSession((url) => {
      seen.push(url)
    })

    setBrowserSessionUrl('https://example.com/')
    // A repeat of the same URL is not a navigation.
    setBrowserSessionUrl('https://example.com/')
    expect(browserSessionUrl()).toBe('https://example.com/')
    expect(seen).toEqual(['https://example.com/'])

    unsubscribe()
    setBrowserSessionUrl('https://example.org/')
    expect(seen).toEqual(['https://example.com/'])
  })

  it('routes opens through the registered workspace opener', () => {
    expect(openInAppBrowser('https://example.com')).toBe(false)

    const opened: string[] = []
    const unregister = registerInAppBrowserOpener((url) => {
      opened.push(url)
    })
    expect(openInAppBrowser('https://example.com')).toBe(true)
    expect(opened).toEqual(['https://example.com'])

    unregister()
    expect(openInAppBrowser('https://example.org')).toBe(false)
  })

  it('a stale unregister does not evict a newer opener', () => {
    const first = registerInAppBrowserOpener(() => {})
    const opened: string[] = []
    registerInAppBrowserOpener((url) => {
      opened.push(url)
    })
    first()
    expect(openInAppBrowser('https://example.com')).toBe(true)
    expect(opened).toEqual(['https://example.com'])
  })
})
