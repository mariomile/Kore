import { parseHtmlFragment } from './html-to-markdown-parse'
import { renderHtmlFragment } from './html-to-markdown-render'

/**
 * Convert article HTML (Defuddle output, or a fallback `article`/`main`
 * subtree) into GitHub-flavored markdown. The clipper stores that markdown
 * in `contentText`; paragraph flattening is only the last-resort fallback.
 */
export interface HtmlToMarkdownOptions {
  /** Resolve relative `href`/`src` values against this page URL. */
  readonly baseUrl?: string
}

/** Convert an HTML fragment into trimmed GFM markdown. */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
  const rendered = renderHtmlFragment(parseHtmlFragment(html), {
    baseUrl: options.baseUrl,
  })
  return rendered.replaceAll(/[ \t]+\n/g, '\n').replaceAll(/\n{3,}/g, '\n\n').trim()
}
