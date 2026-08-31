import { captureMetaFetch } from '../graph/commands'
import { parsePageMeta } from './meta-scrape'

/**
 * Link previews — what a line holding nothing but a pasted URL renders as.
 *
 * The markdown stays a plain link (it is the source of truth, and a card is a
 * rendering of it, never a syntax of its own); this module supplies the copy
 * that card draws. The page is fetched through the same hard-capped Rust
 * `capture_meta_fetch` primitive link capture uses, and parsed with
 * `DOMParser` — never regex over HTML.
 *
 * Nothing here decides *whether* a link may be fetched: a preview is an
 * outbound request to the linked host, so the caller applies the privacy gate
 * (a `private: true` note never previews) before asking.
 */

export interface LinkPreview {
  /** The link this describes, exactly as the note writes it. */
  url: string
  /** `og:title`, falling back to `<title>`. A page with neither has no card. */
  title: string
  /** `og:description`, falling back to the meta description. */
  description: string | null
  /** `og:site_name`, falling back to the host without its `www.`. */
  siteName: string
  /** `og:image` (or `twitter:image`), resolved absolute. */
  imageUrl: string | null
}

/** The host as a site name: `www.` is chrome, not identity. */
function hostLabel(url: URL): string {
  return url.hostname.replace(/^www\./, '')
}

/** An absolute http(s) URL for a possibly relative meta value, or null. */
function absoluteUrl(value: string | null, base: URL): string | null {
  if (value === null) {
    return null
  }
  let resolved: URL
  try {
    resolved = new URL(value, base)
  } catch {
    return null
  }
  return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.href : null
}

function metaContent(document: Document, selector: string): string | null {
  const content = document.querySelector(selector)?.getAttribute('content')?.trim()
  return content === undefined || content === '' ? null : content
}

/**
 * Build a page's preview from its HTML. Returns `null` when the page names
 * itself nothing — a card with no title says less than the link it replaced.
 */
export function parseLinkPreview(html: string, url: string): LinkPreview | null {
  let base: URL
  try {
    base = new URL(url)
  } catch {
    return null
  }
  const meta = parsePageMeta(html)
  if (meta.title === null) {
    return null
  }
  const document = new DOMParser().parseFromString(html, 'text/html')
  return {
    url,
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName ?? hostLabel(base),
    imageUrl: absoluteUrl(
      metaContent(document, 'meta[property="og:image"]') ??
        metaContent(document, 'meta[name="twitter:image"]'),
      base,
    ),
  }
}

/** One in-flight or settled lookup per URL, for the life of the session. */
const previews = new Map<string, Promise<LinkPreview | null>>()

/**
 * The preview for one link, or `null` when the page cannot describe itself
 * (unreachable, blocked, or untitled). Every outcome — the failures included —
 * is remembered per URL for the session, so a note full of the same link
 * fetches once and a dead host is not retried on every keystroke.
 */
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  const cached = previews.get(url)
  if (cached !== undefined) {
    return cached
  }
  const pending = captureMetaFetch(url)
    .then((html) => parseLinkPreview(html, url))
    .catch(() => null)
  previews.set(url, pending)
  return pending
}
