import { z } from 'zod'
import { browserEmbedLoad, browserEmbedRead, type BrowserPageRead } from '../../browser/commands'
import { errorMessage } from '../../errors'

/**
 * The open_web_page / read_web_page executors: the chat model drives the
 * app's built-in browser (the embedded webview behind the browser tab and
 * the context rail's Browser panel) and reads pages back as text. The tool
 * registration, names, and transcript unions stay in `./tools` — this module
 * only knows how to open and extract one page.
 *
 * Browsing is local: the shell's webview fetches the page directly, nothing
 * proxies through Reflect infrastructure. What the agent opens is what the
 * user sees — the pane shares one webview session with these tools — so
 * agent browsing is always inspectable. Page text is untrusted input; the
 * system prompt tells the model to treat it as data, never instructions.
 */

/** Cap on returned page text so one page can't flood the context. */
export const MAX_PAGE_TEXT_CHARS = 20_000

export const WEB_URL_ERROR = 'Only http(s) pages can be opened. Pass a full web URL.'

/** The corrective refusal on surfaces with no embedded browser (web, mobile). */
export const BROWSER_UNAVAILABLE_ERROR =
  'The built-in browser is not available here — it needs the desktop app.'

export const openWebPageInput = z.object({
  url: z
    .string()
    .min(1)
    .describe(
      'The http(s) page to open in the built-in browser, e.g. "https://example.com/docs". ' +
        'To search the web, open https://html.duckduckgo.com/html/?q=your+query and read the result links.',
    ),
})

export const readWebPageInput = z.object({})

/** One extracted page, as the model sees it. */
export interface WebPageContent {
  /** The final URL after redirects. */
  url: string
  title: string
  /** The page's visible text, capped at {@link MAX_PAGE_TEXT_CHARS}. */
  text: string
  /** True when the text was cut at the cap. */
  truncated: boolean
}

/** A page, or a corrective refusal the model can act on. Type-stable. */
export type BrowseWebOutput = { ok: true; page: WebPageContent } | { ok: false; error: string }

/** The effects the browse executors need, already defaulted by the caller. */
export interface BrowseWebDeps {
  browseLoadFn: (url: string) => Promise<void>
  browseReadFn: (options?: { expectUrl?: string; maxChars?: number }) => Promise<BrowserPageRead>
}

/** The default effects: the shell's embedded-browser commands. */
export const shellBrowseDeps: BrowseWebDeps = {
  browseLoadFn: browserEmbedLoad,
  browseReadFn: browserEmbedRead,
}

function pageFromRead(read: BrowserPageRead): WebPageContent {
  return { url: read.url, title: read.title, text: read.text, truncated: read.truncated }
}

/**
 * Build the open_web_page executor: load the URL in the embedded browser and
 * return the page's text once the document settles. Every failure — an
 * unavailable surface, a refused scheme, a page that never answers — comes
 * back as a corrective `ok: false` rather than a thrown tool error.
 * `available` is the host's typed capability answer (the desktop passes
 * whether it runs in a native, non-mobile shell) — never inferred from
 * error-message prose.
 */
export function buildOpenWebPage(deps: BrowseWebDeps, available = true) {
  return async function openWebPage(url: string): Promise<BrowseWebOutput> {
    if (!available) {
      return { ok: false, error: BROWSER_UNAVAILABLE_ERROR }
    }
    if (!/^https?:\/\//i.test(url.trim())) {
      return { ok: false, error: WEB_URL_ERROR }
    }
    try {
      await deps.browseLoadFn(url)
      const read = await deps.browseReadFn({ expectUrl: url, maxChars: MAX_PAGE_TEXT_CHARS })
      return { ok: true, page: pageFromRead(read) }
    } catch (cause) {
      return { ok: false, error: errorMessage(cause) }
    }
  }
}

/**
 * Build the read_web_page executor: extract whatever page the built-in
 * browser is currently on — the user's "look at this page", or a re-read
 * after in-page navigation.
 */
export function buildReadWebPage(deps: BrowseWebDeps, available = true) {
  return async function readWebPage(): Promise<BrowseWebOutput> {
    if (!available) {
      return { ok: false, error: BROWSER_UNAVAILABLE_ERROR }
    }
    try {
      const read = await deps.browseReadFn({ maxChars: MAX_PAGE_TEXT_CHARS })
      return { ok: true, page: pageFromRead(read) }
    } catch (cause) {
      return { ok: false, error: errorMessage(cause) }
    }
  }
}
