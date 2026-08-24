/**
 * The embedded browser's session state, outliving any one host mount — the
 * same lifetime rule as the terminal's PTY. The current URL survives route
 * switches, and the workspace registers an opener here so plain modules
 * (the editor's link handler) can land a page in the in-app browser tab
 * without holding a router.
 */

export const DEFAULT_BROWSER_URL = 'https://duckduckgo.com/'

let currentUrl: string = DEFAULT_BROWSER_URL
const listeners = new Set<(url: string) => void>()
let opener: ((url: string) => void) | null = null

/** The page the embedded browser is on (or should open with). */
export function browserSessionUrl(): string {
  return currentUrl
}

/** Record a navigation (ours or the page's own) and notify subscribers. */
export function setBrowserSessionUrl(url: string): void {
  if (url === currentUrl) {
    return
  }
  currentUrl = url
  for (const listener of listeners) {
    listener(url)
  }
}

/** Follow the session URL (a mounted pane's URL bar). */
export function subscribeBrowserSession(listener: (url: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Register the workspace's "open the browser surface on this URL" action.
 * Returns the unregister cleanup; the last registration wins, so a secondary
 * note window (which registers nothing) keeps its separate-window fallback.
 */
export function registerInAppBrowserOpener(open: (url: string) => void): () => void {
  opener = open
  return () => {
    if (opener === open) {
      opener = null
    }
  }
}

/**
 * Open `url` in the in-app browser surface when a workspace registered one.
 * False means no surface exists here (a chrome-free note window) and the
 * caller should fall back to the separate browser window.
 */
export function openInAppBrowser(url: string): boolean {
  if (opener === null) {
    return false
  }
  opener(url)
  return true
}

/** Test seam: forget the session between tests. */
export function resetBrowserSessionForTests(): void {
  currentUrl = DEFAULT_BROWSER_URL
  listeners.clear()
  opener = null
}
