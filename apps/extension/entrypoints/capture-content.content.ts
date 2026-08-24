import Defuddle from 'defuddle'
import { browser } from 'wxt/browser'
import { htmlToMarkdown } from '@/lib/html-to-markdown'
import {
  extractPageTextRequestSchema,
  formatParagraphs,
  normalizeParagraphText,
  pageTextFromArticleHtml,
  samePageUrl,
  type ExtractPageTextResponse,
} from '@/lib/page-text'

type PageTextListener = (message: unknown) => Promise<ExtractPageTextResponse> | undefined

declare global {
  interface Window {
    __reflectCaptureTextListener?: PageTextListener
  }
}

const PRIMARY_TEXT_SELECTOR = 'p, [role="paragraph"]'
const FALLBACK_TEXT_SELECTOR = `${PRIMARY_TEXT_SELECTOR}, li, blockquote, pre, div`

function isVisibleElement(element: Element): boolean {
  if (!element.isConnected) {
    return true
  }
  const view = element.ownerDocument.defaultView
  if (!view) {
    return true
  }
  const style = view.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function textFromElements(elements: readonly Element[]): string[] {
  return elements
    .filter(isVisibleElement)
    .map((paragraph) => normalizeParagraphText(paragraph.textContent ?? ''))
    .filter((text) => text.length > 0)
}

function hasNestedTextBlock(element: Element): boolean {
  return Array.from(element.children).some(
    (child) => child.matches(FALLBACK_TEXT_SELECTOR) || child.querySelector(FALLBACK_TEXT_SELECTOR),
  )
}

function visibleTextBlocks(root: ParentNode): string[] {
  const primaryText = textFromElements(Array.from(root.querySelectorAll(PRIMARY_TEXT_SELECTOR)))
  if (primaryText.length > 0) {
    return primaryText
  }
  const fallback = Array.from(root.querySelectorAll(FALLBACK_TEXT_SELECTOR)).filter(
    (element) => !hasNestedTextBlock(element),
  )
  return textFromElements(fallback)
}

function fallbackParagraphs(): string[] {
  const root = document.querySelector('article, main') ?? document.body
  return root ? visibleTextBlocks(root) : []
}

function fallbackPageText(): string {
  const root = document.querySelector('article, main') ?? document.body
  if (root) {
    const markdown = htmlToMarkdown(root.innerHTML, { baseUrl: document.location.href })
    if (markdown !== '') {
      return markdown
    }
  }
  return formatParagraphs(fallbackParagraphs())
}

function extractPageText(expectedUrl: string): ExtractPageTextResponse {
  if (!samePageUrl(document.location.href, expectedUrl)) {
    return { ok: false, message: 'page URL changed before text extraction' }
  }
  try {
    const clone = document.cloneNode(true)
    if (!(clone instanceof Document)) {
      return { ok: true, contentText: fallbackPageText() }
    }
    const article = new Defuddle(clone, {
      url: document.location.href,
      useAsync: false,
      includeReplies: false,
      removeImages: false,
    }).parse()
    const contentText = article.content
      ? pageTextFromArticleHtml(article.content, fallbackParagraphs(), {
          baseUrl: document.location.href,
        })
      : fallbackPageText()
    return { ok: true, contentText }
  } catch (cause) {
    try {
      return { ok: true, contentText: fallbackPageText() }
    } catch {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    const previousListener = window.__reflectCaptureTextListener
    if (previousListener) {
      browser.runtime.onMessage.removeListener(previousListener)
    }

    const listener: PageTextListener = (message) => {
      const request = extractPageTextRequestSchema.safeParse(message)
      if (!request.success) {
        return
      }
      return Promise.resolve(extractPageText(request.data.expectedUrl))
    }
    window.__reflectCaptureTextListener = listener
    browser.runtime.onMessage.addListener(listener)
  },
})
