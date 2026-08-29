import { z } from 'zod'

/**
 * Settings for the in-app browser: which search engine it uses and whether
 * web links in notes open there. The engine also decides the browser's home
 * page, so the URLs it implies live here rather than at a call site.
 */

/**
 * Search engine used when the in-app browser's address bar is free text
 * rather than a URL. DuckDuckGo is the default (no tracking, no account).
 */
export const browserSearchEngineSchema = z
  .enum(['duckduckgo', 'google', 'bing'])
  .catch('duckduckgo')

export type BrowserSearchEngine = z.infer<typeof browserSearchEngineSchema>

interface SearchEngineUrls {
  /** The engine's own front page — the browser's home. */
  readonly home: string
  /** Query prefix; the encoded terms are appended. */
  readonly query: string
}

const SEARCH_ENGINE_URLS: Record<BrowserSearchEngine, SearchEngineUrls> = {
  duckduckgo: { home: 'https://duckduckgo.com/', query: 'https://duckduckgo.com/?q=' },
  google: { home: 'https://www.google.com/', query: 'https://www.google.com/search?q=' },
  bing: { home: 'https://www.bing.com/', query: 'https://www.bing.com/search?q=' },
}

/**
 * The page the in-app browser opens on with no session of its own: the
 * chosen engine's front page. The setting names one search engine, so it has
 * to reach the blank tab too — landing on DuckDuckGo after picking Google
 * reads as the preference being ignored.
 */
export function browserSearchHomeUrl(engine: BrowserSearchEngine): string {
  return SEARCH_ENGINE_URLS[engine].home
}

/** The chosen engine's results page for `query`. */
export function browserSearchUrl(engine: BrowserSearchEngine, query: string): string {
  return `${SEARCH_ENGINE_URLS[engine].query}${encodeURIComponent(query)}`
}

/**
 * Whether web links in notes open in the in-app browser. Off sends them to
 * the OS default browser. Alt-click always does the opposite of this choice.
 */
export const browserOpenLinksInAppSchema = z.boolean().catch(true)
