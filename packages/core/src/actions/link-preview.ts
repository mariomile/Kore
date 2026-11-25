import { z } from 'zod'
import { captureMetaFetch, captureOEmbedFetch } from '../graph/commands'
import { parsePageMeta } from './meta-scrape'
import {
  cleanLinkedInTitle,
  isLinkedInUrl,
  linkedInEmbedUrl,
  parseXPost,
  xPostId,
  xSyndicationUrl,
  type LinkPreviewProvider,
  type XPost,
} from './link-preview-providers'

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

interface LinkPreviewBase {
  /** The link this describes, exactly as the note writes it. */
  url: string
  /** `og:site_name`, falling back to the host without its `www.`. */
  siteName: string
  /** The site the card draws itself as, when it has its own look. */
  provider: LinkPreviewProvider | null
  /** The page's (or post's) image, resolved absolute. */
  imageUrl: string | null
  /** The page's favicon, resolved absolute — `/favicon.ico` when undeclared. */
  iconUrl: string | null
}

/** Any page that describes itself with a title (OpenGraph, then `<title>`). */
export interface PageLinkPreview extends LinkPreviewBase {
  kind: 'page'
  /** `og:title`, falling back to `<title>`. A page with neither has no card. */
  title: string
  /** `og:description`, falling back to the meta description. */
  description: string | null
}

/** One social post, drawn as the post: its author, words and counts. */
export interface PostLinkPreview extends LinkPreviewBase, Omit<XPost, 'imageUrl'> {
  kind: 'post'
}

export type LinkPreview = PageLinkPreview | PostLinkPreview

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
export function parseLinkPreview(html: string, url: string): PageLinkPreview | null {
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
  const linkedIn = isLinkedInUrl(url)
  const declaredIcon = document
    .querySelector('link[rel~="icon"][href], link[rel="apple-touch-icon"][href]')
    ?.getAttribute('href')
  return {
    kind: 'page',
    url,
    title: linkedIn ? cleanLinkedInTitle(meta.title) : meta.title,
    description: meta.description,
    siteName: linkedIn ? 'LinkedIn' : (meta.siteName ?? hostLabel(base)),
    provider: linkedIn ? 'linkedin' : null,
    imageUrl: absoluteUrl(
      metaContent(document, 'meta[property="og:image"]') ??
        metaContent(document, 'meta[name="twitter:image"]'),
      base,
    ),
    iconUrl: absoluteUrl(declaredIcon?.trim() || '/favicon.ico', base),
  }
}

/** Build an X post's preview from its syndication answer, or `null`. */
export function parseXLinkPreview(json: string, url: string): PostLinkPreview | null {
  const post = parseXPost(json)
  if (post === null) {
    return null
  }
  return {
    kind: 'post',
    url,
    siteName: 'x.com',
    provider: 'x',
    iconUrl: null,
    ...post,
  }
}

/**
 * Ask the network for one link's preview. X posts read from X's syndication
 * endpoint through the bounded JSON primitive (x.com's HTML has no post in
 * it, so there is no scrape to fall back to); every other page takes the
 * HTML scrape, LinkedIn feed links at their public embed page.
 */
async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const postId = xPostId(url)
  if (postId !== null) {
    return parseXLinkPreview(await captureOEmbedFetch(xSyndicationUrl(postId)), url)
  }
  // A feed link would fetch LinkedIn's sign-in wall, whose title would make
  // a confident card about nothing; its public embed page names the post.
  const target = linkedInEmbedUrl(url) ?? url
  const preview = parseLinkPreview(await captureMetaFetch(target), target)
  return preview === null ? null : { ...preview, url }
}

/** One in-flight or settled lookup per URL, for the life of the session. */
const previews = new Map<string, Promise<LinkPreview | null>>()

/** Bound concurrent outbound fetches + DOMParser parses during link-heavy scroll. */
const MAX_CONCURRENT_PREVIEWS = 3
let activePreviewFetches = 0
const previewQueue: (() => void)[] = []

function enqueuePreviewFetch<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = (): void => {
      activePreviewFetches += 1
      Promise.resolve()
        .then(run)
        .then(resolve, reject)
        .finally(() => {
          activePreviewFetches -= 1
          previewQueue.shift()?.()
        })
    }
    if (activePreviewFetches < MAX_CONCURRENT_PREVIEWS) {
      start()
    } else {
      previewQueue.push(start)
    }
  })
}

/**
 * How long a failed fetch (a throw: offline, a timeout, a refused status)
 * stays remembered before the next ask tries again. A phone on a weak
 * connection times out on a heavy page (a YouTube page is ~1 MB behind three
 * redirects); remembering that for the whole session left the link bare
 * until the app restarted. An answer that parsed to nothing (an untitled
 * page) is final for the session.
 */
export const LINK_PREVIEW_RETRY_MS = 30_000

/** When each URL's last fetch failed, for {@link LINK_PREVIEW_RETRY_MS}. */
const failedAt = new Map<string, number>()

/**
 * Where previews outlive the session: the host keeps them on the device
 * (the desktop app in local storage), so a note opened after a relaunch
 * draws its cards at once instead of fetching every link again. Core
 * decides what is kept and for how long; the store only holds bytes.
 */
export interface LinkPreviewStore {
  /** The entry saved for `url`, as saved, or null. */
  read: (url: string) => unknown
  write: (url: string, entry: StoredLinkPreview) => void
}

export interface StoredLinkPreview {
  readonly preview: LinkPreview
  /** When it was fetched, in epoch milliseconds. */
  readonly savedAt: number
}

/** How long a saved preview is drawn before the page is asked again. */
export const LINK_PREVIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let store: LinkPreviewStore | null = null

/** Install (or with null, remove) the device's preview store. */
export function setLinkPreviewStore(next: LinkPreviewStore | null): void {
  store = next
}

const nullableString = z.string().nullable()
const previewBase = {
  url: z.string(),
  siteName: z.string(),
  provider: z.enum(['x', 'linkedin']).nullable(),
  imageUrl: nullableString,
  iconUrl: nullableString,
}
const storedPreviewSchema = z.object({
  savedAt: z.number(),
  preview: z.discriminatedUnion('kind', [
    z.object({
      ...previewBase,
      kind: z.literal('page'),
      title: z.string(),
      description: nullableString,
    }),
    z.object({
      ...previewBase,
      kind: z.literal('post'),
      authorName: z.string(),
      authorHandle: z.string(),
      avatarUrl: nullableString,
      publishedAt: nullableString,
      text: z.string(),
      replies: z.number().nullable(),
      reposts: z.number().nullable(),
      likes: z.number().nullable(),
    }),
  ]),
})

/** The saved preview for `url` while it is fresh, or null. */
function savedPreview(url: string, now: number): LinkPreview | null {
  let entry: unknown
  try {
    entry = store?.read(url) ?? null
  } catch {
    return null
  }
  const parsed = storedPreviewSchema.safeParse(entry)
  if (!parsed.success || parsed.data.preview.url !== url) {
    return null
  }
  const age = now - parsed.data.savedAt
  return age >= 0 && age < LINK_PREVIEW_MAX_AGE_MS ? parsed.data.preview : null
}

function savePreview(url: string, preview: LinkPreview, now: number): void {
  try {
    store?.write(url, { preview, savedAt: now })
  } catch {
    // A full or unavailable store costs the next launch a fetch, nothing more.
  }
}

/**
 * The preview for one link, or `null` when the page cannot describe itself
 * (unreachable, blocked, or untitled). Every outcome is remembered per URL,
 * so a note full of the same link fetches once and a dead host is not
 * retried on every keystroke; a failed fetch is asked again once
 * {@link LINK_PREVIEW_RETRY_MS} has passed. A preview fetched within
 * {@link LINK_PREVIEW_MAX_AGE_MS}, in this session or an earlier one, is
 * drawn without fetching. Concurrent fetches are capped so scrolling
 * through link-heavy daily notes never saturates IPC or main-thread HTML
 * parsing.
 */
export function loadLinkPreview(
  url: string,
  now: () => number = Date.now,
): Promise<LinkPreview | null> {
  const cached = previews.get(url)
  const failed = failedAt.get(url)
  if (cached !== undefined && (failed === undefined || now() - failed < LINK_PREVIEW_RETRY_MS)) {
    return cached
  }
  if (cached === undefined) {
    const saved = savedPreview(url, now())
    if (saved !== null) {
      const ready = Promise.resolve(saved)
      previews.set(url, ready)
      return ready
    }
  }
  failedAt.delete(url)
  const pending = enqueuePreviewFetch(() => fetchLinkPreview(url)).then(
    (preview) => {
      if (preview !== null) {
        savePreview(url, preview, now())
      }
      return preview
    },
    () => {
      failedAt.set(url, now())
      return null
    },
  )
  previews.set(url, pending)
  return pending
}
