import { useCallback } from 'react'
import type { LinkClickHandler } from '@meowdown/core'
import { errorMessage, openBrowserWindow } from '@reflect/core'
import { isDeepLinkUrl } from '@/lib/deep-links/parse'
import { useFollowDeepLink } from '@/lib/deep-links/use-follow-deep-link'
import { openUrlSync } from '@/lib/open-url'

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
 * Open a rendered Markdown link without letting the click navigate the app's
 * WebView frame. The static `MarkdownView` surfaces aren't contenteditable,
 * so an `<a href>` click would otherwise unload the whole app.
 *
 * Routing: a `reflect://` link goes through the in-app deep-link pipeline
 * (the OS opener denies the scheme); a plain click on a web page opens the
 * in-app browser window so reading a link never leaves the app, with the OS
 * browser as the fallback when the shell can't build the window; a
 * modifier-click — and every non-web app scheme — goes to the OS opener.
 */
export function useOpenExternalLink(): LinkClickHandler {
  const followDeepLink = useFollowDeepLink()
  return useCallback<LinkClickHandler>(
    ({ href, event, mod }) => {
      event.preventDefault()
      if (isDeepLinkUrl(href)) {
        followDeepLink({ href, openInNewWindow: mod })
        return
      }
      if (!isOpenableExternalUrl(href)) {
        return
      }
      if (!mod && isWebUrl(href)) {
        void openBrowserWindow(href).catch((cause: unknown) => {
          console.error(`in-app browser failed for ${href}:`, errorMessage(cause))
          openUrlSync(href)
        })
        return
      }
      openUrlSync(href)
    },
    [followDeepLink],
  )
}
