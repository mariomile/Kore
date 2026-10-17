import { calloutLabel, parseCalloutMarker } from '@reflect/core'

/**
 * Callouts in read-only renderings (`MarkdownView`: previews, transclusions,
 * Canvas cards, the HTML export). The markdown went through
 * `separateCalloutTitles` first, so a callout's title is its blockquote's
 * first paragraph; this stamps the attributes `styles/callouts.css` paints
 * and trims the `[!type]±` token off the rendered title. The view is never
 * editable, so rewriting its text nodes changes nothing on disk.
 */

/** The rendered title text the stamp left, to tell a re-render from our own edit. */
const STAMPED_TEXT = 'calloutText'

/**
 * Drop the first `count` characters of `element`'s text, across text nodes,
 * and return the first node touched. Text nodes are edited in place rather
 * than added or removed, so the renderer's own tree stays intact.
 */
function trimLeadingText(element: Element, count: number): Node | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode()
  let remaining = count
  for (let node = first; node !== null && remaining > 0; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    const cut = Math.min(remaining, text.length)
    node.nodeValue = text.slice(cut)
    remaining -= cut
  }
  return first
}

function clear(quote: Element, title: Element | null): void {
  quote.removeAttribute('data-callout')
  quote.removeAttribute('data-callout-fold')
  quote.removeAttribute('data-callout-folded')
  if (title instanceof HTMLElement) {
    title.removeAttribute('data-callout-title')
    delete title.dataset[STAMPED_TEXT]
  }
}

export interface DecorateCalloutsOptions {
  /** Keep `[!x]-` callouts collapsed (default true); an export shows everything. */
  readonly folding?: boolean
}

/**
 * Stamp every callout blockquote under `root`. Idempotent: a title it already
 * trimmed is recognized by the text it left, and a re-rendered one (its text
 * changed under us) is read again from scratch.
 */
export function decorateCallouts(root: ParentNode, options: DecorateCalloutsOptions = {}): void {
  const folding = options.folding ?? true
  for (const quote of root.querySelectorAll('blockquote')) {
    const title = quote.firstElementChild
    if (!(title instanceof HTMLElement) || title.tagName !== 'P') {
      clear(quote, null)
      continue
    }
    const text = title.textContent ?? ''
    if (title.dataset[STAMPED_TEXT] === text) {
      continue
    }
    const marker = parseCalloutMarker(text.split('\n', 1)[0] ?? '')
    if (marker === null) {
      clear(quote, title)
      continue
    }
    const fold = folding ? marker.fold : 'none'
    quote.setAttribute('data-callout', marker.kind)
    quote.setAttribute('data-callout-fold', fold)
    if (fold === 'closed') {
      quote.setAttribute('data-callout-folded', '')
    } else {
      quote.removeAttribute('data-callout-folded')
    }
    const firstText = trimLeadingText(title, marker.markerLength)
    if (marker.title === null && firstText !== null) {
      firstText.nodeValue = calloutLabel(marker) + (firstText.nodeValue ?? '')
    }
    title.setAttribute('data-callout-title', '')
    title.dataset[STAMPED_TEXT] = title.textContent ?? ''
  }
}

/**
 * Things in a title that act on their own click: native controls, plus the
 * renderer's links, tags and atom chips (a wiki link is a span, not an `<a>`).
 */
const TITLE_CONTROLS =
  'a, button, input, [role="button"], [role="link"], .md-link, .md-tag, .md-atom-view'

/**
 * Fold or unfold the callout whose title was clicked. Returns whether the
 * click was a fold toggle, so the caller can stop it from doing anything else.
 */
export function toggleCalloutFromClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  const title = target.closest('[data-callout-title]')
  const quote = title?.parentElement
  if (quote == null || quote.tagName !== 'BLOCKQUOTE' || title !== quote.firstElementChild) {
    return false
  }
  if (target.closest(TITLE_CONTROLS) !== null) {
    return false
  }
  const fold = quote.getAttribute('data-callout-fold')
  if (fold !== 'open' && fold !== 'closed') {
    return false
  }
  quote.toggleAttribute('data-callout-folded')
  return true
}
