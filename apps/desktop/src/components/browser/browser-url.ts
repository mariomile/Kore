import type { BrowserSearchEngine } from '@reflect/core'

const SEARCH_URLS = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
} as const satisfies Record<BrowserSearchEngine, string>

/** Turn a field value into an http(s) URL, or null when there is nothing to open. */
export function urlForInput(
  raw: string,
  engine: BrowserSearchEngine = 'duckduckgo',
): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `${SEARCH_URLS[engine]}${encodeURIComponent(trimmed)}`
}
