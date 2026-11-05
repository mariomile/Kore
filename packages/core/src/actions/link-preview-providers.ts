import { z } from 'zod'

/**
 * Provider-shaped link previews: the sites whose pages say too little in
 * their HTML for the generic OpenGraph scrape, or say it in a shape worth
 * drawing differently. Everything here is policy over text the Rust fetch
 * primitives already bounded — which URLs belong to a provider, where to ask
 * about them, and how to read the answer. Adding a provider is a
 * TypeScript-only change.
 */

/** Which site a preview came from, when the card draws it as that site. */
export type LinkPreviewProvider = 'x' | 'linkedin'

// ---- X ------------------------------------------------------------------------

const X_HOSTS: ReadonlySet<string> = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
])

/** Post ids are snowflakes: decimal, at most 20 digits. */
const X_STATUS_PATH = /^\/(?:\w{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,20})(?:\/|$)/

/**
 * The post id an X (or twitter.com) link addresses, or `null` when the link
 * is not one post — a profile, a search, or another site.
 */
export function xPostId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  if (!X_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null
  }
  return X_STATUS_PATH.exec(parsed.pathname)?.[1] ?? null
}

/**
 * The syndication endpoint X's own embed widget reads a post from. x.com
 * itself serves a script shell with no post in its HTML, so the generic
 * scrape has nothing to read there; this answers one post as JSON with no
 * sign-in. The `token` is the widget's own derivation from the id — the
 * endpoint checks it is present, not that it is secret.
 */
export function xSyndicationUrl(id: string): string {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replaceAll(/0+|\./g, '')
  const request = new URL('https://cdn.syndication.twimg.com/tweet-result')
  request.searchParams.set('id', id)
  request.searchParams.set('lang', 'en')
  request.searchParams.set('token', token)
  return request.href
}

const count = z.number().int().nonnegative().optional()

const xPostSchema = z.object({
  text: z.string(),
  created_at: z.string().optional(),
  display_text_range: z.tuple([z.number(), z.number()]).optional(),
  favorite_count: count,
  conversation_count: count,
  retweet_count: count,
  reply_count: count,
  entities: z
    .object({
      urls: z.array(z.object({ url: z.string(), display_url: z.string() })).optional(),
    })
    .optional(),
  user: z.object({
    name: z.string(),
    screen_name: z.string(),
    profile_image_url_https: z.string().optional(),
  }),
  photos: z.array(z.object({ url: z.string() })).optional(),
  mediaDetails: z.array(z.object({ media_url_https: z.string() })).optional(),
})

/** One X post, as its card draws it. */
export interface XPost {
  authorName: string
  /** Without the `@`. */
  authorHandle: string
  avatarUrl: string | null
  /** ISO 8601, or null when the answer carried no parsable date. */
  publishedAt: string | null
  /** The post's own words: no trailing media link, links shown as written. */
  text: string
  replies: number | null
  reposts: number | null
  likes: number | null
  /** The first photo (or video still), for a card that shows one. */
  imageUrl: string | null
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

/** X escapes the post text as HTML; the card draws it as text. */
function decodeEntities(text: string): string {
  return text.replaceAll(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
}

function httpsUrl(value: string | undefined): string | null {
  if (value === undefined) {
    return null
  }
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/**
 * Read one post from the syndication answer's JSON text, or `null` when the
 * answer is not a post (a tombstone for a deleted or protected one, an error
 * object, or not JSON at all).
 */
export function parseXPost(json: string): XPost | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = xPostSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  const post = parsed.data
  // The display range drops the trailing t.co link X appends for attached
  // media (and leading reply mentions). Its indices count code points.
  const codePoints = Array.from(post.text)
  const [start, end] = post.display_text_range ?? [0, codePoints.length]
  let text = codePoints.slice(start, end).join('')
  for (const link of post.entities?.urls ?? []) {
    text = text.replaceAll(link.url, link.display_url)
  }
  text = decodeEntities(text).trim()
  const published = post.created_at === undefined ? NaN : Date.parse(post.created_at)
  return {
    authorName: post.user.name,
    authorHandle: post.user.screen_name,
    // The `_normal` avatar is 48px; the card draws it at retina size.
    avatarUrl: httpsUrl(post.user.profile_image_url_https?.replace('_normal.', '_bigger.')),
    publishedAt: Number.isNaN(published) ? null : new Date(published).toISOString(),
    text,
    replies: post.conversation_count ?? post.reply_count ?? null,
    reposts: post.retweet_count ?? null,
    likes: post.favorite_count ?? null,
    imageUrl: httpsUrl(post.photos?.[0]?.url ?? post.mediaDetails?.[0]?.media_url_https),
  }
}

// ---- LinkedIn -----------------------------------------------------------------

/** Whether a link points at LinkedIn (including its `lnkd.in` short links). */
export function isLinkedInUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in'
}

/**
 * The public embed page for a `/feed/update/urn:li:…` link, or `null` for
 * every other link. Feed links send a signed-out fetch to the sign-in wall;
 * the embed page for the same post is public and names it.
 */
export function linkedInEmbedUrl(url: string): string | null {
  if (!isLinkedInUrl(url)) {
    return null
  }
  const urn = /^\/feed\/update\/(urn:li:(?:activity|share|ugcPost):\d+)\/?$/.exec(
    new URL(url).pathname,
  )?.[1]
  return urn === undefined ? null : `https://www.linkedin.com/embed/feed/update/${urn}`
}

/**
 * LinkedIn titles carry their own chrome — `"<post> | <name> posted on the
 * topic | LinkedIn"` — that the card already says with its LinkedIn mark.
 */
export function cleanLinkedInTitle(title: string): string {
  const parts = title.split(' | ')
  if (parts.length > 1 && parts.at(-1)?.trim() === 'LinkedIn') {
    parts.pop()
  }
  if (parts.length > 1 && (parts.at(-1) ?? '').endsWith(' posted on the topic')) {
    parts.pop()
  }
  return parts.join(' | ').trim() || title
}
