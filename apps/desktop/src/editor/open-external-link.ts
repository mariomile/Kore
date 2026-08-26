import { useCallback } from 'react'
import type { LinkClickHandler } from '@meowdown/core'
import { errorMessage, openBrowserWindow } from '@reflect/core'
import { openInAppBrowser } from '@/lib/browser-session'
import { isDeepLinkUrl } from '@/lib/deep-links/parse'
import { useFollowDeepLink } from '@/lib/deep-links/use-follow-deep-link'
import { openUrlSync } from '@/lib/open-url'
import { useOptionalSettings } from '@/providers/settings-provider'

/**
 * Schemes that must never reach the OS opener: script and data URIs carry
 * executable content rather than an address, and `file:`/`blob:` open
 * arbitrary local content a synced or captured note could point at.
 */
const BLOCKED_SCHEMES: ReadonlySet<string> = new Set([
  'javascript',
  'vbscript',
  'data',
  'blob',
  'about',
  'file',
])

/**
 * Whether `href` is an absolute URL that may be handed to the OS opener.
 * Any app scheme qualifies (`https:`, `x-devonthink-item:`, `bear:`, …) —
 * the OS resolves the handler — but the blocked schemes and scheme-less
 * relative hrefs never do. The opener capability mirrors this policy
 * (`*://*` allowed, `file://*` denied) as the Rust-side backstop.
 */
export function isOpenableExternalUrl(href: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]
  return scheme !== undefined && !BLOCKED_SCHEMES.has(scheme.toLowerCase())
}

/** Whether `href` is a web page the in-app browser window can host. */
export function isWebUrl(href: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  return scheme === 'http' || scheme === 'https'
}

/**
 * Open an external URL by the app's one routing rule — shared by the static
 * Markdown surfaces and the editor so a link never behaves differently by
 * where it was clicked. Web pages open the built-in browser: the workspace's
 * embedded surface when one is registered, else a separate browser window
 * (with the OS opener as the fallback when the shell can't build one).
 * `osBrowser` (the Alt-click escape hatch) and every non-web app scheme go
 * to the OS opener, which owns its handler. Unsafe schemes never open
 * anything.
 */
export function openExternalUrl(href: string, options?: { osBrowser?: boolean }): void {
  if (!isOpenableExternalUrl(href)) {
    return
  }
  if (options?.osBrowser !== true && isWebUrl(href)) {
    // The workspace hosts the built-in browser (a tab / the context rail);
    // a chrome-free note window has no such surface and keeps the separate
    // browser window instead.
    if (openInAppBrowser(href)) {
      return
    }
    void openBrowserWindow(href).catch((cause: unknown) => {
      console.error(`in-app browser failed for ${href}:`, errorMessage(cause))
      openUrlSync(href)
    })
    return
  }
  openUrlSync(href)
}

/**
 * Whether a click with Alt held should go to the OS browser.
 *
 * When links open in-app, Alt is the OS-browser escape hatch. When they
 * open in the OS browser, Alt inverts and uses the in-app window.
 */
export function preferOsBrowser(altKey: boolean, openLinksInApp: boolean): boolean {
  return altKey === openLinksInApp
}

/**
 * Open a rendered Markdown link without letting the click navigate the app's
 * WebView frame. The static `MarkdownView` surfaces aren't contenteditable,
 * so an `<a href>` click would otherwise unload the whole app.
 *
 * Routing: a `reflect://` link goes through the in-app deep-link pipeline
 * (the OS opener denies the scheme); a web page opens the in-app browser
 * so reading a link never leaves the app — whatever the gesture, since
 * inside the editor mod-click IS the open gesture (a plain click just places
 * the caret) — with Alt held as the deliberate invert of
 * `browserOpenLinksInApp`, and the OS opener as the fallback when the shell
 * can't build the window; every non-web app scheme goes to the OS opener,
 * which owns its handler.
 */
export function useOpenExternalLink(): LinkClickHandler {
  const followDeepLink = useFollowDeepLink()
  const openLinksInApp = useOptionalSettings()?.settings.browserOpenLinksInApp ?? true
  return useCallback<LinkClickHandler>(
    ({ href, event, mod }) => {
      event.preventDefault()
      if (isDeepLinkUrl(href)) {
        followDeepLink({ href, openInNewWindow: mod })
        return
      }
      const altKey = 'altKey' in event && event.altKey
      openExternalUrl(href, { osBrowser: preferOsBrowser(altKey, openLinksInApp) })
    },
    [followDeepLink, openLinksInApp],
  )
}
