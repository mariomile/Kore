/**
 * What a URL points at, from the URL alone.
 *
 * A link in a note is opaque: `https://…/watch?v=…` and `https://…/owner/repo`
 * render identically, so the only way to learn what a saved link holds is to
 * open it. Classifying the URL lets every surface that shows one say what it
 * is — a typed embed card, a typed capture note — without a network round
 * trip, without an API key, and offline.
 *
 * Deliberately conservative: the classifier reads hosts and path shapes it
 * recognises and answers {@link LINK_KIND_FALLBACK} for everything else. It
 * never guesses from a page's content, and a wrong guess is worse than the
 * honest generic.
 */

/** The kinds a link can be classified as. */
export const LINK_KINDS = [
  'article',
  'video',
  'image',
  'audio',
  'repo',
  'document',
  'social',
  'link',
] as const

/** One conservative URL category inferred without a network request. */
export type LinkKind = (typeof LINK_KINDS)[number]

/** What an unrecognised — or unparseable — URL classifies as. */
export const LINK_KIND_FALLBACK: LinkKind = 'link'

/** One kind's display metadata: the word for it, and the tag it contributes. */
export interface LinkKindInfo {
  /** Sentence-case label for a card or chip ("Video"). */
  readonly label: string
  /** Tag name (no `#`) a typed capture adds beside `#link`. */
  readonly tag: string
}

const LINK_KIND_INFO: Record<LinkKind, LinkKindInfo> = {
  article: { label: 'Article', tag: 'article' },
  video: { label: 'Video', tag: 'video' },
  image: { label: 'Image', tag: 'image' },
  audio: { label: 'Audio', tag: 'audio' },
  repo: { label: 'Repository', tag: 'repo' },
  document: { label: 'Document', tag: 'document' },
  social: { label: 'Post', tag: 'post' },
  link: { label: 'Link', tag: 'link' },
}

/** Display metadata for `kind`. */
export function linkKindInfo(kind: LinkKind): LinkKindInfo {
  return LINK_KIND_INFO[kind]
}

/** Extensions that identify the resource by name, whatever host serves it. */
const EXTENSION_KINDS: ReadonlyArray<readonly [RegExp, LinkKind]> = [
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp|heic)$/i, 'image'],
  [/\.(mp4|webm|mov|m4v|mkv)$/i, 'video'],
  [/\.(mp3|wav|m4a|aac|ogg|flac)$/i, 'audio'],
  [/\.(pdf|epub|docx?|pptx?|xlsx?|csv|rtf)$/i, 'document'],
]

/** Hosts whose every URL is one kind (the suffix also covers subdomains). */
const HOST_KINDS: ReadonlyArray<readonly [string, LinkKind]> = [
  ['youtube.com', 'video'],
  ['youtu.be', 'video'],
  ['vimeo.com', 'video'],
  ['twitch.tv', 'video'],
  ['dailymotion.com', 'video'],
  ['loom.com', 'video'],
  ['soundcloud.com', 'audio'],
  ['spotify.com', 'audio'],
  ['podcasts.apple.com', 'audio'],
  ['overcast.fm', 'audio'],
  ['x.com', 'social'],
  ['twitter.com', 'social'],
  ['bsky.app', 'social'],
  ['mastodon.social', 'social'],
  ['threads.net', 'social'],
  ['linkedin.com', 'social'],
  ['reddit.com', 'social'],
  ['instagram.com', 'social'],
  ['imgur.com', 'image'],
  ['flickr.com', 'image'],
  ['arxiv.org', 'document'],
  ['medium.com', 'article'],
  ['substack.com', 'article'],
  ['nytimes.com', 'article'],
  ['theguardian.com', 'article'],
  ['wikipedia.org', 'article'],
]

/** Hosts where a two-segment path is a repository and anything else is not. */
const FORGE_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org', 'sr.ht']

/** Forge paths that are a site section, never an owner. */
const FORGE_RESERVED = new Set([
  'about',
  'apps',
  'blog',
  'collections',
  'explore',
  'features',
  'issues',
  'marketplace',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'sponsors',
  'topics',
  'trending',
])

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/**
 * A forge URL is a repository when its path is exactly `owner/repo` — a
 * deeper path is a file, an issue or a pull request, and a single segment is
 * a profile or a site section.
 */
function forgeKind(segments: readonly string[]): LinkKind | null {
  if (segments.length !== 2) {
    return null
  }
  const owner = segments[0] ?? ''
  return FORGE_RESERVED.has(owner.toLowerCase()) ? null : 'repo'
}

/**
 * Classify `url`. Returns {@link LINK_KIND_FALLBACK} for anything the
 * classifier does not recognise, including a URL it cannot parse and any
 * scheme other than http(s).
 */
export function linkKind(url: string): LinkKind {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return LINK_KIND_FALLBACK
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return LINK_KIND_FALLBACK
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const segments = parsed.pathname.split('/').filter(Boolean)

  // The filename wins over the host: a `.pdf` on a news site is a document.
  for (const [pattern, kind] of EXTENSION_KINDS) {
    if (pattern.test(parsed.pathname)) {
      return kind
    }
  }
  for (const forge of FORGE_HOSTS) {
    if (hostMatches(host, forge)) {
      return forgeKind(segments) ?? LINK_KIND_FALLBACK
    }
  }
  for (const [suffix, kind] of HOST_KINDS) {
    if (hostMatches(host, suffix)) {
      return kind
    }
  }
  return LINK_KIND_FALLBACK
}

/** YouTube and Vimeo ids, for the players an embed card can offer to load. */
const PLAYER_PATTERNS: ReadonlyArray<{
  readonly host: string
  readonly extract: (url: URL) => string | null
  readonly embed: (id: string) => string
}> = [
  {
    host: 'youtube.com',
    extract: (url) => url.searchParams.get('v') ?? shortsId(url),
    embed: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
  {
    host: 'youtu.be',
    extract: (url) => url.pathname.split('/').find(Boolean) ?? null,
    embed: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
  {
    host: 'vimeo.com',
    extract: (url) => {
      const first = url.pathname.split('/').find(Boolean) ?? ''
      return /^\d+$/.test(first) ? first : null
    },
    embed: (id) => `https://player.vimeo.com/video/${id}`,
  },
]

function shortsId(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean)
  return segments[0] === 'shorts' || segments[0] === 'embed' ? (segments[1] ?? null) : null
}

/**
 * The privacy-preserving player URL for `url`, or `null` when the video has
 * no known embeddable player. YouTube resolves through `youtube-nocookie.com`
 * — the player is only ever loaded on an explicit click, so the request tells
 * the provider the user pressed play, not that they opened a note.
 */
export function videoPlayerUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  for (const player of PLAYER_PATTERNS) {
    if (!hostMatches(host, player.host)) {
      continue
    }
    const id = player.extract(parsed)
    return id !== null && /^[\w-]+$/.test(id) ? player.embed(id) : null
  }
  return null
}
