import Defuddle from 'defuddle'
import { htmlToMarkdown, type HtmlToMarkdownOptions } from '../markdown/html-to-markdown'

export { htmlToMarkdown, type HtmlToMarkdownOptions }

/**
 * The article extractor shared by every capture path that keeps a page's
 * words: a pasted link's card (`actions/link-text`) and the Kore Capture
 * extension's page text. Defuddle picks the readable content out of the
 * page chrome; `htmlToMarkdown` turns it into GFM. It reads a `Document`, so
 * it runs wherever one exists: the live tab in the extension, or a
 * `DOMParser` document built from fetched HTML in the app.
 */
export interface ArticleText {
  /** The article's own title (Defuddle's pick of og/meta/`<title>`), if any. */
  readonly title: string | null
  /** The article body as Markdown; empty when the page has no readable text. */
  readonly markdown: string
}

function cleanTitle(value: string | null | undefined): string | null {
  const collapsed = value?.replaceAll(/\s+/g, ' ').trim() ?? ''
  return collapsed === '' ? null : collapsed
}

/** The page's `article`/`main`/`body` subtree as Markdown, for pages Defuddle cannot read. */
function subtreeMarkdown(document: Document, baseUrl: string): string {
  const root = document.querySelector('article, main') ?? document.body
  return root === null ? '' : htmlToMarkdown(root.innerHTML, { baseUrl })
}

/**
 * Extract one document's article as Markdown. Defuddle edits the document it
 * reads, so pass a clone (or a document built for this call). Never throws:
 * a Defuddle failure falls back to the page's main subtree.
 */
export function extractArticle(document: Document, url: string): ArticleText {
  const fallbackTitle = cleanTitle(document.querySelector('title')?.textContent)
  try {
    const article = new Defuddle(document, {
      url,
      useAsync: false,
      includeReplies: false,
      removeImages: false,
    }).parse()
    const markdown = article.content ? htmlToMarkdown(article.content, { baseUrl: url }) : ''
    return {
      title: cleanTitle(article.title) ?? fallbackTitle,
      markdown: markdown !== '' ? markdown : subtreeMarkdown(document, url),
    }
  } catch {
    return { title: fallbackTitle, markdown: subtreeMarkdown(document, url) }
  }
}

/** Extract the article from fetched HTML. The document is inert: no script runs. */
export function extractArticleFromHtml(html: string, url: string): ArticleText {
  return extractArticle(new DOMParser().parseFromString(html, 'text/html'), url)
}
